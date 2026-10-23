# VoiceLab Instagram publisher

A small app, separate from the website, that posts to Instagram by itself from a queue. It is its own Vercel project. It has no public pages: the media folder is only there so Instagram can download each file when it posts.

## How it works

- **The queue** is `src/data/queue.json`. Each post has a date, a caption, and its images (a carousel) or a video (a Reel).
- **Once a day** Vercel Cron calls `/api/publish` (`vercel.json`, time in UTC). It posts the oldest post whose date has come, in your time zone. It posts one a day, and skips anything more than two days late.
- **Instagram posts.** Each post is three steps: a container for the media, a wait while Instagram processes it, then publish.
- **Its own record** lives in one private Vercel Blob file, `social/state.json`. That file holds what went out, the renewed token, and the last error. A claim stops two runs posting the same thing.
- **Only production posts.** Preview deployments never post.

## Adding posts

From `social/`:

```sh
node scripts/add-media.mjs nerves-um ../renders/carousels/nerves-um/{1,2,3,4,5,6}.png
node scripts/add-media.mjs overview ../renders/batch-1/Overview-story.mp4=reel ../renders/batch-1/covers/Overview-cover.png=cover
```

The script turns PNG into JPEG, because Instagram's API only takes JPEG.

Add an entry to `queue.json` on a branch and open a pull request. The branch's preview home page shows the queue with the real media and captions. **Merging is the approval.** `pnpm check` validates the queue and that every file exists.

## One-time setup

1. **The Vercel project.** Choose Add New → Project, pick `riqs07/voicelab-marketing` again, and set **Root Directory: `social`**. Name it something like `voicelab-social`.
2. **A Meta developer app** with the Instagram use case. Connect the professional account and generate a token with `instagram_business_content_publish`.
3. **Environment variables.** In the project's Settings → Environment Variables (Production only, Sensitive), add:
   - `INSTAGRAM_ACCESS_TOKEN`: the token;
   - `CRON_SECRET`: any long random string.
4. **A Blob store.** Under Storage → Create → Blob, choose **private** and connect it to this project.
5. **First test.** Merge, then go to Settings → Cron Jobs and press **Run**.

The token lasts 60 days and is renewed weekly. A brand-new token can't be renewed until it's a day old; that's harmless.

## Checking on it

- The function logs show `Social: posted …` or the error.
- `/api/publish?dry=1`, sent with the cron secret, shows what would post next without posting.
- Instagram's API can't add music from its library, tag people, or set the "AI info" label. Add the label by hand after a Reel posts.
