import fetch from "node-fetch";
import * as path from "path";
import { promises as fs } from "fs";
import * as cp from "child_process";

async function perr<T>(
    promise: Promise<T>,
): Promise<
    { error: undefined; result: T } | { error: Error; result: undefined }
> {
    let result;
    try {
        result = await promise;
    } catch (e) {
        return { result: undefined, error: e };
    }
    return { result: result, error: undefined };
}

type Entry =
    | string // hfy wiki page
    | {
          type: "series";
          title: string;
          author: string;
          entries: Entry[];
      }
    | {
          type: "authorfilter";
          author: string;
          username: string;
          subreddit: string;
          titlesearch: string;
          title: string;
          stop: string;
      }
    | {
          type: "tocpost";
          post: string;
          title: string;
      }
    | {
          type: "set";
          title: string;
          author: string;
          posts: string[];
      };

let configFile = path.join(process.cwd(), "books/config.json");
let cacheDir = path.join(process.cwd(), "cache");
let distStories = path.join(process.cwd(), "dist/markdown");
let distEpubs = path.join(process.cwd(), "dist/epub");
let distKindle = path.join(process.cwd(), "dist/kindle");

function exec(program: string, args: string[]) {
    return new Promise((res, rej) => {
        cp.execFile(program, args, (err, stdout, _stderr) => {
            if (err) {
                console.log(err);
                rej(err);
            }
            console.log(stdout);
            res();
        });
    });
}

async function run() {
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.mkdir(distStories, { recursive: true });
    await fs.mkdir(distEpubs, { recursive: true });
    await fs.mkdir(distKindle, { recursive: true });

    let config = await fs.readFile(configFile, "utf-8");
    let conf = JSON.parse(config) as Entry[];

    let toGenerate: string[] = [];
    for (let entry of conf) {
        console.log("Starting entry", entry);
        let book = await downloadEntry(entry);
        let writeResult = await writeBook(book);
        if (writeResult != null) toGenerate.push(writeResult);
    }
    await Promise.all(
        toGenerate.map(async file => {
            let fileName = file.substr(file.lastIndexOf("/"));
            console.log("Pandoc started on " + fileName);
            let epubFile = path.join(distEpubs, fileName + ".epub");
            let kindlegenDistFile = path.join(distEpubs, fileName + ".mobi");
            let kindleFile = path.join(distKindle, fileName + ".mobi");
            await exec("pandoc", [
                "-o",
                epubFile,
                file,
                "--toc",
                "--toc-depth=1",
            ]);
            console.log("Kindlenge started on " + fileName);
            let kindlegenResult = await perr(exec("kindlegen", [epubFile]));
            console.log("Working as intended: ", kindlegenResult.error);
            // kindlegen frequently exits with a non-0 exit code
            await fs.rename(kindlegenDistFile, kindleFile);
            console.log("Done with " + fileName);
        }),
    );
    console.log("Done!");
}

type CacheFile = {
    lastUpdated: number;
    text: string;
};

function safePath(text: string): string {
    return text.replace(/[\/\n\r]/g, "_");
}

async function cacheLoad<T>(url: string) {
    let shortURL = url.replace("https://www.reddit.com/", "");
    console.log("Loading", shortURL);

    let pathFile = path.join(cacheDir, safePath(url));
    let cacheText = await perr(fs.readFile(pathFile, "utf-8"));

    if (cacheText.error) {
        let pageData = await (await fetch(url)).text();
        let newCacheText = JSON.stringify({
            lastUpdated: new Date().getTime(),
            text: pageData,
        } as CacheFile);
        await fs.writeFile(pathFile, newCacheText, "utf-8");
        console.log("Downloaded", shortURL);
        return JSON.parse(pageData) as T;
    } else {
        console.log("Uncached", shortURL);
        return JSON.parse(JSON.parse(cacheText.result).text) as T;
    }
}

type WikiEntry = {
    kind: "wikipage";
    data: {
        content_md: string;
    };
};

type EntryResult = {
    title: string;
    author: string;
    content: string;
};

function extractAllLinks(markdown: string) {
    return [...markdown.matchAll(/\[(.+?)\]\s*\((.+?)\)/g)!].map(l => ({
        title: l[1],
        url: l[2],
    }));
}

type RedditComment = {
    kind: "t1" | "more";
    data: {
        author: string;
        body: any;
        replies: { data: { children: RedditComment[] } };
    };
};
type RedditPost = [
    {
        data: {
            children: [
                {
                    data: {
                        selftext: string;
                        title: string;
                        author: string;
                        subreddit: string;
                    };
                },
            ];
        };
    },
    {
        data: {
            children: RedditComment[];
        };
    },
];

async function downloadStory(url: string) {
    let fullmarkdown: string[] = [];

    let story = await cacheLoad<RedditPost>(url);

    const postData = story[0].data.children[0].data;
    const postSelfText = postData.selftext;
    fullmarkdown.push(`

# ${postData.title}

*by [u/${postData.author}](https://reddit.com/u/${postData.author}) on [r/${postData.subreddit}](https://reddit.com/r/${postData.subreddit})*

---

`);
    fullmarkdown.push(postSelfText);
    fullmarkdown.push("\n\n---\n\n*Replies*\n\n");
    const comments = story[1].data.children;
    const filterComments = (cditem: RedditComment) =>
        cditem.kind === "t1" && cditem.data.author === postData.author;
    let commentsMap = (cditem: RedditComment): string =>
        cditem.kind === "t1" && cditem.data.author === postData.author
            ? `*u/${cditem.data.author}*\n\n---\n\n${
                  cditem.data.body
              }\n\n---\n\n*Replies*\n\n${
                  cditem.data && cditem.data.replies
                      ? cditem.data.replies.data.children
                            .filter(filterComments)
                            .map(commentsMap)
                            .join("\n\n---\n\n")
                      : "> No Replies"
              }`
            : cditem.kind === "more"
            ? "\n\n...More Available but not loaded\n\n"
            : "\n\n*Other user reply*\n\n";
    let result = comments
        .filter(filterComments)
        .map(commentsMap)
        .join("\n\n---\n\n");
    fullmarkdown.push(result);

    return fullmarkdown
        .join("\n")
        .split("&amp;#x200B;")
        .join("")
        .split("&amp;nbsp;")
        .join("\xa0");
}

async function downloadManyPosts(posts: string[]) {
    return (
        await Promise.all(posts.map(async post => await downloadStory(post)))
    ).join("\n\n");
}

async function downloadWikiSet(wikiText: string): Promise<string> {
    let links = extractAllLinks(wikiText).filter(link => {
        if (!link.url.startsWith("https://www.reddit.com")) return false;
        if (!link.url.includes("/comments/")) return false;
        return true;
    });
    return await downloadManyPosts(links.map(link => link.url + ".json"));
}

function hfyWikiMeta(wikiText: string) {
    let removeMD = (text: string) => text.replace(/[#*\[\]]/g, "");

    let title = removeMD(wikiText.split("\n").find(l => l.startsWith("#"))!);
    let author = removeMD(wikiText.split("\n").find(l => l.trim())!);

    return { title, author };
}

function assertNever(v: never): never {
    console.log("Was not never: ", v);
    throw new Error("Was not never.");
}

// for authorfilter:
type SubmittedData = {
    data: {
        children: {
            data: {
                subreddit: string;
                title: string;
                url: string;
            };
        }[];
        after: string;
    };
};
async function downloadAfter(username: string, after?: string) {
    return await cacheLoad<SubmittedData>(
        "https://www.reddit.com/user/" +
            username +
            "/submitted.json" +
            (after ? "?after=" + after : ""),
    );
}
async function downloadAllPostsFromUser(
    username: string,
    subreddit: string,
    titleFilter: (title: string) => boolean,
    stopAt: string,
) {
    let lastCount = -1;
    let full = [];
    let after: string | undefined = undefined;
    while (lastCount !== 0) {
        let userprofile = (await downloadAfter(
            username,
            after,
        )) as SubmittedData;
        lastCount = userprofile.data.children.length;
        after = userprofile.data.after;
        full.push(
            ...userprofile.data.children
                .filter(
                    l =>
                        l.data.subreddit === subreddit &&
                        titleFilter(l.data.title),
                )
                .map(l => {
                    console.log(l.data.title);
                    if (l.data.title === stopAt) after = undefined;
                    return l;
                })
                .map(l => l.data.url.replace(/\/$/, ".json")),
        );
        if (!after) {
            break;
        }
    }
    return full.reverse();
}

async function downloadEntry(entry: Entry): Promise<EntryResult> {
    if (typeof entry === "string") {
        let wikiPage = await cacheLoad<WikiEntry>(entry + ".json");
        let wikiText = wikiPage.data.content_md;
        let meta = hfyWikiMeta(wikiText);
        return {
            title: meta.title,
            author: meta.author,
            content: await downloadWikiSet(wikiText),
        };
    }
    if (entry.type === "series") {
        let resContent: string[] = [];
        for (let entr of entry.entries) {
            let book = await downloadEntry(entr);
            resContent.push("# " + book.title);
            resContent.push(book.content);
        }
        return {
            title: entry.title,
            author: entry.author,
            content: resContent.join("\n\n"),
        };
    }
    if (entry.type === "authorfilter") {
        return {
            title: entry.title,
            author: entry.author,
            content: await downloadManyPosts(
                await downloadAllPostsFromUser(
                    entry.username,
                    entry.subreddit,
                    t => t.includes(entry.titlesearch),
                    entry.stop,
                ),
            ),
        };
    }
    if (entry.type === "tocpost") {
        let commentPage = await cacheLoad<RedditPost>(entry.post + ".json");
        let author = commentPage[0].data.children[0].data.author;
        let wikiText = commentPage[0].data.children[0].data.selftext;
        return {
            title: entry.title,
            author,
            content: await downloadWikiSet(wikiText),
        };
    }
    if (entry.type === "set") {
        return {
            title: entry.title,
            author: entry.author,
            content: await downloadManyPosts(entry.posts),
        };
    }
    assertNever(entry);
}

async function writeBook(book: EntryResult): Promise<string | undefined> {
    let outFile = path.join(distStories, safePath(book.title) + ".md");
    let finalContent = `---
author: "${book.author}"
title: "${book.title}"
---

${book.content}

# that's it`.replace(/\n\n+/g, "\n\n");
    let existingText = await perr(fs.readFile(outFile, "utf-8"));
    if (existingText.error || existingText.result !== finalContent) {
        await fs.writeFile(outFile, finalContent, "utf-8");
        console.log("Assembled " + outFile);
        return outFile;
    } else {
        console.log("No changes need to be made to " + outFile);
    }
}

run();
