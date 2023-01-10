requirements: pandoc, kindlegen, bun.sh

generates markdown, epub, and mobi files from reddit self-posts and serieses.

usage: `bun src/saveoffline.ts`

configuration: create `books/config.ts`

mobile reading: use https://pfg.pw/sitepages/reader

mobile downloading: use the application from the terminal. TODO: implement rsd directly into threadclient, or at least make a web app for it

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
