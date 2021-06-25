requirements: pandoc, kindlegen, node, yarn

generates markdown, epub, and mobi files from reddit self-posts and serieses.

usage: setup (`yarn install`), then run (`yarn go`)

configuration: edit `books/config.json`. make sure your entries match this type[]:

```ts
type Entry =
    | string // link to hfy wiki page. author will be the first link, title will be the heading, print all link pages from top to bottom.
    | {
          // a set of entries combined into one with a consistent title and author
          type: "series";
          title: string;
          author: string;
          entries: Entry[];
      }
    | {
          // search through an author's history matching posts with titles containing titlesearch until the post titled stop is reached or the user has no more posts. print in reverse order
          type: "authorfilter";
          author: string;
          username: string;
          subreddit: string;
          titlesearch: string;
          title: string;
          stop: string;
      }
    | {
          // use a selfpost as a "table of contents". author of the post is author. print all link pages from top to bottom.
          type: "tocpost";
          post: string;
          title: string;
      }
    | {
          // use an array of posts directly. posts must be links to reddit api pages (end with .json)
          type: "set";
          title: string;
          author: string;
          posts: string[];
      };
```

if your entries do not match with that type, there will probably be undescriptive errors.

## known issues

formatting is not perfect. pandoc markdown is different from reddit markdown. no attempt is made to remove in-post headings, so posts may occasionally have unusual headings. no attempt is made to link to chapters, so in-post "next" and "previous" links are real web browser links.

link parsing is incorrect.

all other issues except the ones I did not know about.

## todo

stories like this: https://www.reddit.com/r/WritingPrompts/comments/3pyg3h/wp_a_day_before_the_earth_is_destroyed_by_a/

-   very deep comment chains. any comment chains that require clicking to read more will not be completed
-   comments not from op. only comments from op that are either direct replies to the post itself or direct replies to valid comments are included

how it could be done in the future:

```json
{
    "type": "commentchain",
    "post": "https://www.reddit.com/r/WritingPrompts/comments/3pyg3h/wp_a_day_before_the_earth_is_destroyed_by_a/",
    "comment": "cwali3n",
    "title": "A day before the Earth is destroyed by a collision with a rouge planet, time freezes."
}
```
