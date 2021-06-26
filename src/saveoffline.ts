import fetch from "node-fetch";
import * as path from "path";
import { promises as fs } from "fs";
import * as cp from "child_process";
import { config } from "../books/config";
import * as util from "util";

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

export type Entry =
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

let cacheDir = path.join(process.cwd(), "cache");
let distStories = path.join(process.cwd(), "dist/html");
let distEpubs = path.join(process.cwd(), "dist/epub");
let distKindle = path.join(process.cwd(), "dist/kindle");
let distLog = path.join(process.cwd(), "dist/logs");

function exec(env: Env, program: string, args: string[]) {
    return new Promise<void>((res, rej) => {
        cp.execFile(program, args, (err, stdout, _stderr) => {
            if (
                err &&
                !stdout.includes(":I1037: Mobi file built with WARNINGS!")
            ) {
                log(env, err);
                return rej(err);
            }
            log(env, stdout);
            res();
        });
    });
}

async function evaluateEntry(env: Env, entry: Entry) {
    log(env, "Starting entry", entry);
    let book = await downloadEntry(env, entry);
    let writeResult = await writeBook(env, book);
    if (writeResult == null) {
        return;
    }

    let fileName = safePath(book.title);
    log(env, "Pandoc started on " + fileName);
    let epubFile = path.join(distEpubs, fileName + ".epub");
    let kindlegenDistFile = path.join(distEpubs, fileName + ".mobi");
    let kindleFile = path.join(distKindle, fileName + ".mobi");
    await exec(env, "pandoc", [
        "-o",
        epubFile,
        "--toc",
        "--toc-depth=1",
        "--metadata-file",
        writeResult.meta,
        writeResult.html,
    ]);
    // note: consider also emitting
    // `-o ….html --toc -s` for a neat standalone html file
    log(env, "Kindlenge started on " + fileName);
    await exec(env, "kindlegen", [epubFile]);
    await fs.rename(kindlegenDistFile, kindleFile);

    // kindlegen frequently exits with a non-0 exit code
}

async function run() {
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.mkdir(distStories, { recursive: true });
    await fs.mkdir(distEpubs, { recursive: true });
    await fs.mkdir(distKindle, { recursive: true });
    await fs.mkdir(distLog, { recursive: true });

    let conf = config;

    let count = 0;

    let results: (number | Error)[] = [];

    await Promise.all(
        conf.map(async (entry, i) => {
            console.log("Starting entry #"+(i+1));
            try {
                const start = Date.now();
                await evaluateEntry({id: i}, entry);
                results[i] = Date.now() - start;
            }catch(e) {
                results[i] = e;
            }
            count++;
            console.log("Completed entry #"+(i+1)+" ("+count+" / "+conf.length+")");
        }),
    );
    console.log("Done!");

    results.forEach((result, i) => {
        console.log("#"+(i+1)+": "+(typeof result === "number" ? "Completed in "+result+"ms." : "Errored:"));
        if(typeof result !== "number") {
            console.log(result);
            console.log(result.stack);
        }
    });

    if(!results.every(result => typeof result === "number")) {
        throw new Error("Errors occured.");
    }
}

type CacheFile = {
    lastUpdated: number;
    text: string;
};

function safePath(text: string): string {
    return text.replace(/[\/\n\r]/g, "_");
}

async function cacheLoad<T>(env: Env, url: string) {
    let shortURL = url.replace("https://www.reddit.com/", "").split("?")[0];

    let pathFile = path.join(cacheDir, safePath(url));
    let cacheText = await perr(fs.readFile(pathFile, "utf-8"));

    if (cacheText.error) {
        log(env, "Loading", shortURL);
        let pageData = await (await fetch(url)).text();
        let newCacheText = JSON.stringify({
            lastUpdated: new Date().getTime(),
            text: pageData,
        } as CacheFile);
        await fs.writeFile(pathFile, newCacheText, "utf-8");
        log(env, "Downloaded", shortURL);
        return JSON.parse(pageData) as T;
    } else {
        // log(env, "Uncached", shortURL);
        return JSON.parse(JSON.parse(cacheText.result).text) as T;
    }
}

type WikiEntry = {
    kind: "wikipage";
    data: {
        content_md: string;
    };
};
export declare namespace Richtext {
    export type Document = {
        document: Paragraph[],
    };
    export type Paragraph = {
        e: "par",
        c: Span[],
    } | {
        e: "img" | "video" | "gif",
        c: string, // caption, displays below the image
        id: string, // media id. more info in media_metadata including the link.
    } | {
        e: "h",
        l: number, // h1 h2 …
        c: Span[],
    } | {
        e: "hr", // horizontal line
    } | {
        e: "blockquote",
        c: Paragraph[],
    } | {
        e: "list",
        o: false, // if the list is ordered
        c: LI[],
    } | {
        e: "code",
        c: Raw[], // I guess they didn't want to use white-space: pre?
    } | {
        e: "table",
        h: TableHeading[],
        c: TableItem[][],
    } | {
        e: "unsupported",
    };
    export type LI = {
        e: "li",
        c: Paragraph[],
    };
    export type Span = {
        e: "text",
        t: string,
        f?: FormatRange[],
    } | {
        e: "r/",
        t: string, // subreddit name unprefixed
        l: boolean, // leading slash
    } | {
        e: "u/",
        t: string, // user name unprefixed
        l: boolean, // leading slash
    } | {
        e: "link",
        u: string, // url
        t: string, // link text
        a?: string, // tooltip text
        f?: FormatRange[],
    } | {
        e: "br", // <br />, a line break within a paragraph
    } | {
        e: "spoilertext",
        c: Span[],
    } | {
        e: "raw", // only in headings idk
        t: string,
    } | {
        e: "gif",
        id: string, // information is provided in media_metadata
    } | {
        e: "unsupported",
    };
    export type TableHeading = {
        a?: "L" | "C" | "R", // align
        c?: Span[],
    };
    export type TableItem = {
        c: Span[],
    };
    // TODO use hljs or something to detect language and highlight
    export type Raw = {
        e: "raw",
        t: string,
    } | {
        e: "unsupported",
    };
    export type FormatRange = [
        mode: FormatMode,
        start: number, // start index
        length: number // length
    ]; // note: format ranges never overlap. this makes it easier to translate this to generic

    // FormatMode is a bitfield
    export enum FormatMode {
        strong = 1,          // 1 << 0      1
        emphasis = 2,       // 1 << 1      10
        strikethrough = 8, // 1 << 3     1000
        superscript = 32, // 1 << 5    100000
        code = 64,       // 1 << 6    1000000
    }
}

type Chapter = {
    name: {title: string, author: string},
    rtjson: Richtext.Document,
    fullname: string | undefined,
};
type TextContent = {
    chapters: Chapter[],
};

type EntryResult = {
    title: string;
    author: string;
    content: TextContent;
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
        rtjson: Richtext.Document,
        replies: { data: { children: RedditComment[] } };
    };
};
type RedditPost = [
    {
        data: {
            children: [
                {
                    data: {
                        rtjson: Richtext.Document,
                        title: string;
                        author: string;
                        subreddit: string;
                        name: string,
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

const rt = {
    par: (...c: Richtext.Span[]): Richtext.Paragraph => ({e: "par", c}),
    txt: (text: string, styles: Richtext.FormatMode = 0): Richtext.Span => ({e: "text", t: text, f: [[styles, 0, text.length]]}),
    raw: (text: string): Richtext.Raw => ({e: "raw", t: text}),
    h: (level: number, ...c: Richtext.Raw[]): Richtext.Paragraph => ({e: "h", l: level, c}),
    hr: (): Richtext.Paragraph => ({e: "hr"}),
};

async function downloadStory(env: Env, url: string): Promise<Chapter> {
    let fullcontent: Richtext.Paragraph[] = [];

    let story = await cacheLoad<RedditPost>(env, url);

    const postData = story[0].data.children[0].data;
    fullcontent.push(...postData.rtjson.document);
    
    fullcontent.push(rt.hr());
    fullcontent.push(rt.par(rt.txt("Replies", 1 << 1)));

    const comments = story[1].data.children;
    const filterComments = (cditem: RedditComment) =>
        cditem.kind === "t1" && cditem.data.author === postData.author;
    let commentsMap = (cditem: RedditComment): Richtext.Paragraph[] =>
        cditem.kind === "t1" && cditem.data.author === postData.author
            ? [
                rt.par(rt.txt("u/"+cditem.data.author, 1 << 1)),
                rt.hr(),
                ...cditem.data.rtjson.document,
                rt.hr(),
                rt.par(rt.txt("Replies", 1 << 1)),

                ...cditem.data && cditem.data.replies
                    ? cditem.data.replies.data.children
                        .filter(filterComments)
                        .flatMap(commentsMap)
                    : [rt.par(rt.txt("> No Replies"))],
            ]
            : cditem.kind === "more"
            ? [rt.par(rt.txt("...More Available but not loaded"))]
            : [rt.par(rt.txt("Other user reply", 1 << 1))];
    let result = comments
        .filter(filterComments)
        .flatMap(commentsMap);
    fullcontent.push(...result.flatMap(q => [q, rt.hr()]));

    return {
        name: {title: postData.title, author: "by u/"+postData.author+" on "+postData.subreddit},
        rtjson: {document: fullcontent},
        fullname: postData.name,
    };
}

async function downloadManyPosts(env: Env, posts: string[]): Promise<TextContent> {
    return {chapters:
        await Promise.all(posts.map(async post => await downloadStory(env, post)))
    };
}

async function downloadWikiSet(env: Env, wikiText: string): Promise<TextContent> {
    let links = extractAllLinks(wikiText).filter(link => {
        if (!link.url.startsWith("https://www.reddit.com")) return false;
        if (!link.url.includes("/comments/")) return false;
        return true;
    });
    return await downloadManyPosts(env, links.map(link => link.url + ".json?raw_json=1&rtj=yes")); // &rtj=only would be okay here b/c we load body pages
}

function hfyWikiMeta(wikiText: string) {
    let removeMD = (text: string) => text.replace(/[#*\[\]]/g, "");

    let title = removeMD(wikiText.split("\n").find(l => l.startsWith("#"))!);
    let author = removeMD(wikiText.split("\n").find(l => l.trim())!);

    return { title, author };
}

function assertNever(env: Env, v: never): never {
    log(env, "Was not never: ", v);
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
async function downloadAfter(env: Env, username: string, after?: string) {
    return await cacheLoad<SubmittedData>(env,
        "https://www.reddit.com/user/" +
            username +
            "/submitted.json?raw_json=1&rtj=yes" +
            (after ? "&after=" + after : ""),
    );
}
async function downloadAllPostsFromUser(
    env: Env,
    username: string,
    subreddit: string,
    titleFilter: (title: string) => boolean,
    stopAt: string,
) {
    let lastCount = -1;
    let full = [];
    let after: string | undefined = undefined;
    let didStop = false;
    while (lastCount !== 0) {
        let userprofile = (await downloadAfter(env,
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
                    log(env, l.data.title);
                    if (l.data.title === stopAt) {
                        after = undefined;
                        didStop = true;
                    }
                    return l;
                })
                .map(l => l.data.url.replace(/\/$/, ".json?raw_json=1&rtj=yes")),
        );
        if (!after) {
            break;
        }
    }
    if(!didStop) throw new Error("Never reached stop title `"+stopAt+"`");
    return full.reverse();
}

async function downloadEntry(env: Env, entry: Entry): Promise<EntryResult> {
    if (typeof entry === "string") {
        let wikiPage = await cacheLoad<WikiEntry>(env, entry + ".json?raw_json=1&rtj=yes");
        let wikiText = wikiPage.data.content_md.replace(/\r/g, "");
        let meta = hfyWikiMeta(wikiText);
        return {
            title: meta.title,
            author: meta.author,
            content: await downloadWikiSet(env, wikiText),
        };
    }
    if (entry.type === "series") {
        let resContent: Chapter[] = [];
        for (let entr of entry.entries) {
            let book = await downloadEntry(env, entr);
            resContent.push({name: {title: book.title, author: "by "+book.author}, fullname: undefined, rtjson: {document: []}});
            for(const chapter of book.content.chapters) {
                resContent.push({name: {...chapter.name, title: "• "+chapter.name.title}, fullname: chapter.fullname, rtjson: chapter.rtjson});
            }
        }
        return {
            title: entry.title,
            author: entry.author,
            content: {
                chapters: resContent,
            },
        };
    }
    if (entry.type === "authorfilter") {
        return {
            title: entry.title,
            author: entry.author,
            content: await downloadManyPosts(env,
                await downloadAllPostsFromUser(env,
                    entry.username,
                    entry.subreddit,
                    t => t.includes(entry.titlesearch),
                    entry.stop,
                ),
            ),
        };
    }
    if (entry.type === "tocpost") {
        let commentPage = await cacheLoad<RedditPost>(env, entry.post + ".json?raw_json=1&rtj=yes");
        let author = commentPage[0].data.children[0].data.author;
        let wikiText = (commentPage[0].data.children[0].data as unknown as {selftext: string}).selftext;
        return {
            title: entry.title,
            author,
            content: await downloadWikiSet(env, wikiText),
        };
    }
    if (entry.type === "set") {
        return {
            title: entry.title,
            author: entry.author,
            content: await downloadManyPosts(env, entry.posts.map(post => post + ".json?raw_json=1&rtj=yes")),
        };
    }
    assertNever(env, entry);
}
type GenericSpan = {
    kind: "text",
    text: string,
    styles: Style,
} | {
    kind: "inline_code",
    text: string,
};
type Style = {
    strong?: boolean,
    emphasis?: boolean,
    strikethrough?: boolean,
    superscript?: boolean,
};
type StyleRes = {
    strong: boolean,
    emphasis: boolean,
    strike: boolean,
    super: boolean,
    code: boolean,
};
function richtextStyle(style: number): StyleRes {
    if(style & ~0b1101011) throw new Error("unsupported style "+style.toString(2)+" ("+style+")");
    return {
        strong: !!(style & 1),
        emphasis: !!(style & 2),
        strike: !!(style & 8),
        super: !!(style & 32),
        code: !!(style & 64),
    };
}
function richtextFormattedText(text: string, format: Richtext.FormatRange[]): GenericSpan[] {
    if(format.length === 0) {
        return [{kind: "text", text: text, styles: {}}];
    }
    const resitems: GenericSpan[] = [];
    let previdx = 0;
    const commit = (endv: number) => {
        const nofmt = text.substring(previdx, endv);
        if(nofmt.length > 0) resitems.push({kind: "text", text: nofmt, styles: {}});
    };
    format.forEach(([fmtid, start, length]) => {
        commit(start);
        previdx = start + length;
        const fmt = text.substr(start, length);
        const resstyl = richtextStyle(fmtid);
        if(resstyl.code) {
            resitems.push({kind: "inline_code", text: fmt});
        }else{
            resitems.push({kind: "text", text: fmt, styles: {
                strong: resstyl.strong,
                emphasis: resstyl.emphasis,
                strikethrough: resstyl.strike,
                superscript: resstyl.super,
            }});
        }
    });
    commit(text.length);
    return resitems;
}
function escapeHTML(unsafe: string): string {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
 }


function renderFormattedText(t: string, f: Richtext.FormatRange[]): string {
    return richtextFormattedText(t, f).map(el => {
        if(el.kind === "inline_code") {
            return "<code>"+escapeHTML(el.text)+"</code>";
        }else{
            let wrapped = escapeHTML(el.text);
            if(el.styles.strong) wrapped = `<b>${wrapped}</b>`;
            if(el.styles.emphasis) wrapped = `<i>${wrapped}</i>`;
            if(el.styles.strikethrough) wrapped = `<del>${wrapped}</del>`;
            if(el.styles.superscript) wrapped = `<sup>${wrapped}</sup>`;
            return wrapped;
        }
    }).join("");
}

type RTEnv = {
    chapters: Set<string>,
};

function spanToString(env: RTEnv, span: Richtext.Span): string {
    if(span.e === "text") {
        return renderFormattedText(span.t, span.f ?? []);
    }else if(span.e === "link") {
        // TODO link to chapter
        let updurl = span.u;
        const rcommentsmatch = updurl.match(/\/comments\/(.+?)\//);
        if(rcommentsmatch) {
            const fullname = "t3_"+rcommentsmatch[1]!;
            if(env.chapters.has(fullname)) updurl = "#"+fullname;
        }
        return "<a"+(span.a ? " title=\""+escapeHTML(span.a)+"\"" : "")+
        " href=\""+escapeHTML(updurl)+"\">"+renderFormattedText(span.t, span.f ?? [])+"</a>";
    }else if(span.e === "u/") {
        return escapeHTML((span.l ? "/" : "") + "u/" + span.t);
    }else if(span.e === "r/") {
        return escapeHTML((span.l ? "/" : "") + "r/" + span.t);
    }else if(span.e === "br") {
        return "<br />\n";
    }else if(span.e === "spoilertext") {
        return "«<b>Spoiler!</b>: <span class=\"spoiler\">"+(span.c.map(a => spanToString(env, a)).join(""))+"</span>»";
    }else if(span.e === "raw") {
        return escapeHTML(span.t);
    }else throw new Error("TODO span e `"+span.e+"`");
}

function paragraphToString(env: RTEnv, par: Richtext.Paragraph): string {
    if(par.e === "par") {
        return "<p>"+par.c.map(c => spanToString(env, c)).join("")+"</p>";
    }else if(par.e === "hr") {
        return "<hr />";
    }else if(par.e === "h") {
        return "<h"+par.l+">"+par.c.map(a => spanToString(env, a)).join("")+"</h"+par.l+">";
    }else if(par.e === "blockquote") {
        return "<blockquote>\n"+par.c.map(itm => paragraphToString(env, itm) + "\n").join("\n")+"</blockquote>";
    }else if(par.e === "table") {
        return "<table>\n<tr>"+par.h.map(h => {
            return (h.c ?? []).map(a => spanToString(env, a)).join("");
        }).join("")+"</tr>\n"+par.c.map(line => {
            return "<tr>"+line.map(itm => itm.c.map(a => spanToString(env, a)).join("")).join("")+"</tr>";
        })+"</table>";
    }else if(par.e === "code") {
        return "<pre><code>"+par.c.map(a => spanToString(env, a)).join("")+"</code></pre>";
    }else if(par.e === "list") {
        const is_o = par.o;

        return (is_o ? "<ol>" : "<ul>") + "\n" + par.c.map(li => {
            return "<li>" + li.c.map(a => paragraphToString(env, a)).join("") + "</li>\n";
        }).join("") + (is_o ? "</ol>" : "</ul>");
    }else throw new Error("TODO par e `"+par.e+"`")
}

function chapterToString(env: RTEnv, chapter: Chapter): string {
    const resmd: string[] = [];
    resmd.push("<h1"+(chapter.fullname ? " id=\""+escapeHTML(chapter.fullname)+"\"" : "")+">" + escapeHTML(chapter.name.title) + "</h1>");
    resmd.push("<i>"+escapeHTML(chapter.name.author)+"</i>");
    resmd.push("<hr />");

    resmd.push(...chapter.rtjson.document.map(par => paragraphToString(env, par)))

    return resmd.join("\n\n");
}

function contentToString(content: TextContent): string {
    const env: RTEnv = {
        chapters: new Set(),
    };
    content.chapters.forEach(chapter => chapter.fullname && env.chapters.add(chapter.fullname));
    return content.chapters.map(a => chapterToString(env, a)).join("\n\n<hr />\n\n");
}

async function writeBook(env: Env, book: EntryResult): Promise<{meta: string, html: string} | undefined> {
    const resultFile = path.join(distStories, safePath(book.title) + ".html");
    const metadataFile = path.join(distStories, safePath(book.title) + ".json");

    await fs.writeFile(metadataFile, JSON.stringify({
        'title': book.title,
        'author': book.author,
        'cover-image': path.resolve(path.join("books", "cover_image.png")),
    }), "utf-8");

    const finalContent = contentToString(book.content);

    let existingText = await perr(fs.readFile(resultFile, "utf-8"));
    if (existingText.error || existingText.result !== finalContent) {
        await fs.writeFile(resultFile, finalContent, "utf-8");
        log(env, "Assembled " + resultFile);
        return {meta: metadataFile, html: resultFile};
    } else {
        log(env, "No changes need to be made to " + book.title);
        return;
    }
}

export class Mutex {
    private mutex = Promise.resolve();

    lock(): PromiseLike<() => void> {
        let begin: (unlock: () => void) => void = unlock => {};

        this.mutex = this.mutex.then(() => {
            return new Promise(begin);
        });

        return new Promise(res => {
            begin = res;
        });
    }

    async dispatch<T>(fn: (() => T) | (() => PromiseLike<T>)): Promise<T> {
        const unlock = await this.lock();
        try {
            return await Promise.resolve(fn());
        } finally {
            unlock();
        }
    }
}

type Env = {id: number};

let logFiles: Mutex[] = [];

function log(env: Env, ...msg: unknown[]) {
    let mode: "appendFile" | "writeFile" = "appendFile";
    if(!logFiles[env.id]) {
        logFiles[env.id] = new Mutex();
        mode = "writeFile";
    }

    const src = ((new Error("").stack ?? "NOLINE").split("\n")[2] ?? "NOLINE").trim();
    const joined = src + ":\n" +
        msg.map((item: unknown) => item instanceof Error ? item.stack : typeof item === "string" ? item : util.inspect(item)).join(" ")
        .split("\n").map(l => "    "+l).join("\n")
        + "\n"
    ;

    void logFiles[env.id].dispatch(async () => {
        await fs[mode](path.join(distLog, (env.id + 1).toString().padStart(5, "0")+".log"), joined, "utf-8");
    });
}

run();
