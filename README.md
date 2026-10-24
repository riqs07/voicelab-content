# VoiceLab Instagram scheduler and publisher

Plan a week of Instagram posts on your computer, press **Send to server**, and they post by themselves at their times. This is separate from the website.

## Using it

From the repository folder, on `main`:

```sh
git checkout main && git pull
pnpm schedule
```

Then open http://localhost:3000.

- **Ready to post** shows everything finished in `renders/`, and the scheduler only posts from there. The tabs switch to **Scheduled** (everything waiting) and **Posted** (already on Instagram).
- **Click an item** to open the post panel:
  - It suggests the next free day; set the time.
  - Choose **Post as Reel** (the default) or **Post as Story**. A Story shows for 24 hours and has no caption or cover.
  - Pick the **cover**: the Reel's own cover is used unless you choose another image or **Pick a frame…** from the video.
  - Edit the caption, with Instagram's character and hashtag limits counted, then press **Schedule**.
- **Up next** (right) lists the next few posts. Click one to change it.
- **Calendar** (top) opens a window with This week, 2 weeks or Month. Click a post to open it, or drag it to another day.
- **Send to server** (top right) pushes the schedule to GitHub. The server has it a minute or two later.

You can keep changing posts after sending: each Send replaces the server's schedule. Posts that went out, or whose time has passed, are locked. A post due within about 90 minutes is marked **Posting soon**, because a change may arrive after it has gone out.

Statuses:
- **Not sent yet**: only on your computer.
- **On the server**: will post at its time, within about an hour.
- **Posted ✓**
- **Failed**: tried again each hour, up to two days late. The reason is shown on the post.

To see Posted and Failed, copy `.env.example` to `.env.local` here and fill it in.

**Posted items tidy themselves up.** Once everything scheduled from an item has posted, the scheduler moves its files into `renders/posted/`, keeping the same folders. A Reel's 9:16 file, 4:5 file and cover move together, and its caption stays in `captions.md`. The move needs `.env.local`, happens while the scheduler is open, and goes up with your next Send.

### Adding something new to post

Put it in `renders/` first; it then appears under Ready to post.

- **A Reel or Story:** `renders/uploads/<name>/` with one `.mp4` (9:16 only), a `cover.png` or `cover.jpg`, and an optional `caption.md` or `caption.txt`. Any other images in the folder can be picked as the cover.
- **A carousel or a single photo:** `renders/uploads/<name>/` with the images named `1.png`, `2.png`… (up to 10), plus an optional caption file.
- Rendered Reels in `renders/batch-*/` and carousels in `renders/carousels/` show up the same way, with their captions from `captions.md` and `caption.md`. See "Guidelines for new videos" in `video/README.md`.

PNGs are turned into JPEG when scheduled, because Instagram's API only takes JPEG. Videos must be MP4.

## How it works

- **The schedule** is `src/data/queue.json`. The media for each post is copied into `public/media/<post>/`, where Instagram downloads it from.
- **The clock** is GitHub Actions (`.github/workflows/social-publish.yml`, at the repository root). It's free and runs every hour, calling this app's `/api/publish`. That publishes the earliest post whose time has come, up to two days late, one per run.
- **Posting** goes through Instagram's API in three steps: a container for the media, a wait while Instagram processes it, then publish.
- **The record** of what went out, the renewed token and the last error lives in one private Vercel Blob file (`social/state.json`). A claim stops two runs posting the same thing.
- **Only the production deployment posts.** The scheduler page and its API only exist when running on your computer.

## One-time setup

1. **The Vercel project.** Choose Add New → Project, pick `riqs07/voicelab-marketing`, set **Root Directory: `social`**, and name it `voicelab-social`.
2. **A Meta developer app** with the Instagram use case. Connect the professional account and generate a token with `instagram_business_content_publish`.
3. **Vercel environment variables** (Production only, Sensitive):
   - `INSTAGRAM_ACCESS_TOKEN`: the token;
   - `CRON_SECRET`: any long random string.
4. **A Blob store.** In Vercel go to Storage → Create → Blob, choose **private**, and connect it to the project.
5. **GitHub settings.** In Settings → Secrets and variables → Actions, add:
   - the secret `SOCIAL_CRON_SECRET`, with the same value as `CRON_SECRET`;
   - the variable `SOCIAL_URL`, the project's address, e.g. `https://voicelab-social.vercel.app`.
6. **Test it.** In the Actions tab, open "Post to Instagram" and press **Run workflow**. With nothing due it answers `"posted": null`.

The token lasts 60 days and is renewed weekly. A brand-new token can't be renewed until it's a day old; that's harmless.

## Checking on it

- The Actions tab lists each hourly run with the publisher's answer. A failed run emails you.
- `/api/publish?dry=1`, sent with the cron secret, shows what would post next without posting.

## Limits

- Instagram's API can't add music from its library, tag people, or set the "AI info" label. Add the label by hand after a Reel posts.
- Stories posted through the API can't have stickers, links or music. Check that Story posting works on your account with one test Story first.
- GitHub turns off scheduled workflows in a repository with no activity for 60 days. Any push turns them back on.
