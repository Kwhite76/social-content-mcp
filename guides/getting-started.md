# Social Content: first-time setup

Social Content is a Claude Desktop extension that turns your brand into a steady stream of social media posts. You describe your brand once; after that, each time you ask for a batch, Claude plans a post for every day, researches and fact-checks it, writes it in your voice, designs the image in your Penpot, turns it into a 20 to 30 second reel, and keeps a log so nothing repeats. If you connect Instagram, each batch also learns from what your recent posts did.

It never posts for you. You review everything and post it yourself.

This guide covers everything from installing to your first post, and explains what each piece does. Plan on about 45 minutes, most of it the brand interview and the optional Instagram connection.

**Contents**
1. How it fits together
2. Before you start
3. Install the extension
4. Set up Penpot
5. Connect Penpot for the first time (the keeper)
6. Build your brand kit (the setup interview)
7. Connect Instagram Insights (optional)
8. Make your first post
9. Making posts from now on
10. Reference: brand settings, reel styles, files
11. Troubleshooting
12. Updating, privacy and turning things off

---

## 1. How it fits together

| Piece | What it does | Where it lives |
|---|---|---|
| **The extension** | Gives Claude the tools to plan, design, render and log posts. Runs on your computer, inside Claude Desktop. | Claude Desktop > Settings > Extensions > Social Content |
| **Your brand kit** | Everything that makes posts yours: your logo, example posts, writing voice, colors, fonts, topics and post formats. The extension has no brand of its own; it only follows your kit. | A folder you choose |
| **Penpot** | A free online design tool. Each post image is built there as an editable design, so you can tweak any post by hand. | design.penpot.app, in a design file of yours |
| **The keeper** | Penpot only takes instructions while its page is open and awake. The keeper keeps a hidden Penpot page open and connected, and reconnects it if it drops. It starts and stops with the extension. | Runs in the background; its files are in `.social-content-mcp/keeper` in your user folder |
| **The reel maker** | Animates each finished post into a 1080x1920 reel in one of 14 motion styles, with short notes over close-ups and your logo at the end. Runs on your computer; nothing is uploaded anywhere. | Reels are saved in your brand kit's `output/` folder |
| **The post log** | Remembers every post: its topic, format, angle, featured subjects, facts, background, layout and reel style. Each new batch is checked against it, so angles, subjects and facts don't repeat. | `history.jsonl` in your brand kit |
| **Instagram Insights** (optional) | Reads how your recent posts did (reach, views, likes, comments, saves, shares, reel watch time, follower vs non-follower reach), so Claude can lean toward what works. Read-only. | Each pull is saved in your brand kit's `insights/` folder |
| **AI-writing check** | A built-in AI-text detector (the desklib DeBERTa-v3 model) scores every caption sentence by sentence, and Claude rewords the sentences that read as AI-written until the caption is under your target (15% by default). Every caption is scored before it's delivered; it isn't optional. It runs on your computer; the model (about 450 MB) downloads once. | The model is kept in `.social-content-mcp/models` in your user folder |
| **Guides** | Step-by-step instructions Claude follows: *setup* (this guide, as an interview), *create_posts* (running a batch) and *connect_instagram* (step 7 on its own). Pick them from the prompts menu in Claude, or just ask. | Built into the extension |

What you get for each post:
- a 1080x1350 image (and its editable design in Penpot)
- a 20 to 30 second reel, with a silent sound track so you can add a sound in Instagram
- a caption with hashtags, checked against your writing rules
- a Story version with a sticker (poll, quiz, slider or question)
- a pinned first comment and reply templates for comments
- music suggestions to search for in Instagram
- sources for every fact

---

## 2. Before you start

You need:
- **A computer** with Windows, macOS (Apple Silicon or Intel) or Linux
- **Claude Desktop**, signed in
- **Chrome or Edge** installed (Windows always has Edge). The keeper uses it to keep Penpot open.
- **About 1 GB of free disk space**: the AI-writing check downloads its model (about 450 MB) once.
- **A Penpot account** (free): design.penpot.app
- For Instagram Insights (optional): an **Instagram professional account** (Business or Creator), a **Facebook account**, and a **business portfolio** (free; you can make one along the way)

Have these ready for the interview:
- your **logo** as a PNG with a transparent background
- 2 to 6 **example posts** you love (yours or others'), as image files
- 2 to 5 **captions** you've written that sound like you
- your **brand colors** and **fonts**, if you know them (Claude can suggest them otherwise)

---

## 3. Install the extension

1. Open the latest release: github.com/Kwhite76/social-content-mcp/releases
2. Download the file for your computer:
   - Windows: `social-content-mcp-<version>-win32-x64.mcpb`
   - Mac with Apple Silicon (M1 and later): `...-darwin-arm64.mcpb`
   - Intel Mac: `...-darwin-x64.mcpb`
   - Linux: `...-linux-x64.mcpb`
3. Double-click it. Claude Desktop opens an install window. Under **Requirements**, every item should have a green check; a warning on your operating system means you downloaded the wrong file.
4. Click **Install** and fill in the settings:

| Setting | What it's for | What to put |
|---|---|---|
| **Brand kit folder** | Where your brand kit, finished posts and reels, post log and Insights are kept | A new, empty folder, for example `Documents/My Brand Kit`. The interview fills it in. |
| **Penpot MCP key** | Lets the extension work in your Penpot. It only works with your account. | From step 4 below (you can come back and add it) |
| **Penpot address** | Which Penpot to use | Leave as is, unless you run your own Penpot server |
| **Instagram access token** (optional) | Lets the extension read your Instagram Insights | From step 7, or leave empty |
| **Instagram account ID** (optional) | Picks the account when a token can see several | Leave empty |
| **Auto-start keeper** | Starts the keeper with the extension | Leave on |

Secret settings (the keys and tokens) are stored by Claude Desktop in your computer's secure storage. You can change any setting later in **Settings > Extensions > Social Content > Configure**.

---

## 4. Set up Penpot

1. Sign in at design.penpot.app (create a free account if you don't have one).
2. Create a **design file** for your posts and give it a name you'll recognize, for example "Brand Posts". Every post image is built here as its own board.
3. Get your **MCP key**: click your avatar > **Your account** > **Integrations** > **MCP Server**, turn it on, and copy the key.
4. Paste it into the extension's **Penpot MCP key** setting and save.

The MCP key lets the extension (and only it) send design instructions to Penpot as you. Keep it private, like a password. If it ever leaks, generate a new one in the same place.

---

## 5. Connect Penpot for the first time (the keeper)

Penpot only accepts instructions through a page that's open in a browser, with its MCP plugin connected. Browsers put background pages to sleep, which would cut the connection, so the extension runs a **keeper**: its own Chrome or Edge, running hidden, with your design file open and the plugin connected. It checks every 30 seconds and makes a real test call through Penpot every minute; if anything stops answering, it restarts and reconnects on its own. If Claude's Penpot request fails mid-task, the extension asks the keeper to reconnect and tries again.

The first time only:
1. After you add the MCP key, a Penpot window opens on your computer (or ask Claude to "start the Penpot keeper").
2. Sign in to Penpot in that window, and open your design file.
3. That's it. The keeper remembers the file, closes the window and keeps running hidden. You'll see "MCP connected" if you ask Claude for the keeper's status.

From then on it starts when Claude Desktop starts and stops when it quits. You only see it again if Penpot signs you out; then the window reopens for you to sign in.

Good to know:
- Only one keeper runs per computer.
- Its files (log, settings, browser profile) are in `.social-content-mcp/keeper` in your user folder.
- To pause it, create an empty file named `PAUSE` in that folder; delete the file to resume.
- Don't open the same Penpot file's MCP connection somewhere else at the same time: Penpot lets only one page hold it, and the keeper will take it back.

---

## 6. Build your brand kit (the setup interview)

In Claude, choose the **setup** prompt (or just say "set up Social Content"). Claude interviews you a few questions at a time and fills in your brand kit for you. You never have to edit settings files, though you can.

What it asks, and what each answer is used for:

**Your brand**
- name, handle, what you do or sell, who follows you: used to keep posts on topic and to judge what your followers care about
- which platforms you post to

**How you write**
- how you talk to followers, in a few words: the voice every caption is written in
- 2 to 5 captions that sound like you: saved in `voice/`, read before every batch
- words or subjects that must never appear (for example competitors, prices, sales words): every caption is checked for them
- emoji yes or no, how many hashtags, caption length, any rules you always follow

**What you post about**
- **Topics**: the 1 to 5 subjects you rotate through (product lines, services, themes)
- **Formats**: the kinds of post, picked from a list (This or That, Did You Know, Behind the Scenes, Hot Take, Myth vs Fact, Rank It, Guess It and more), each with a few angles. Pick 7 for a weekly cycle or 14 for two weeks.
- **Start date** of the rotation: each day gets the next topic and the next format
- the **repeat rules** (defaults: an angle not reused for 42 days, a featured subject not for 30 days, a background at most twice in any 7 posts)

**How posts look**
- the look, in plain words, plus your example posts (Claude looks at them and suggests colors and fonts from them)
- your **logo** (shown at the end of every reel)
- brand **colors** and **fonts** (any Google Font works in Penpot)
- things to avoid in images (for example stock photos or AI-generated images)
- **backgrounds** (optional): your own photos or free-to-use images
- **layouts**: 3 to 6 arrangements, for example "subject left, text right"
- the **reel note style**: `card` (a clean rounded card), `paper` (a paper note with grain) or `plain` (text with a soft shadow); its font (Inter, Kalam or Gochi Hand are built in, or your own font file), colors, and whether it has a strip of tape

Claude reads back a short summary, saves it when you confirm, and checks the kit. Section 10 explains every setting.

Claude also starts the one-time download of the AI-writing check's model (about 450 MB) in the background, so it's ready for your first post.

---

## 7. Connect Instagram Insights (optional)

With Insights, each batch learns from your recent posts: which types, topics and formats reach people and get saved or shared. It's read-only: the extension never posts, comments, likes, follows or changes anything. Without it, batches still work; they just don't use your numbers.

You'll create a small private "app" on Meta's developer site that only you use, generate an access token, and paste it into the extension. You don't need App Review, and you never publish the app. It takes about 15 minutes, once.

You need an **Instagram professional account** (in the Instagram app: Settings > Account type and tools > Switch to professional account; free), a **Facebook account**, and a **business portfolio** (free; you can create it in step 7.2, or beforehand at business.facebook.com). You do **not** need a Facebook Page.

Meta changes these screens from time to time. If yours don't match, look for the closest option, or ask Claude and share a screenshot. To have Claude walk you through just this part, use the **connect_instagram** prompt.

### 7.1 Sign in to Meta for Developers
1. Go to developers.facebook.com and click **Get Started**.
2. Log in with your Facebook account. If Meta asks you to register as a developer, follow its prompts.

### 7.2 Create the app
1. **My Apps** > **Create App**.
2. **App details**: any name (for example "Social Insights") and your email. **Next**.
3. **Use cases**: on the left click **Content management**, then tick **Manage messaging & content on Instagram**. Nothing else. **Next**.
4. **Business**: connect your business portfolio (new apps need one).
5. Click through **Requirements** and **Overview**, then **Create app**. Leave it unpublished; that's all you need to read your own account.

### 7.3 Add the insights permission to the app
1. On the app's **Dashboard**, click **Customize the Manage messaging & content on Instagram use case**.
2. Open **Permissions and features**, find **instagram_manage_insights** and click **Add**. It, and **instagram_basic**, should show *Ready for testing*.

### 7.4 Create the login configuration
The configuration decides what your token is allowed to do.
1. In the same use case, open **API setup with Unified login**. A banner saying "API setup with Instagram login is not available for newer apps" is expected.
2. Under **1. Configure your app**, click **Create new configuration**, keep the defaults, then **Create from template**. It should show **Instagram Login Compatible** and **Selected**.
3. In the left menu, open **Facebook Login for Business > Configurations** and click **Edit** on it. Go to **Permissions**.
4. Tick **instagram_basic** and **instagram_manage_insights**. Untick the rest (ads_management, ads_read, instagram_content_publish, instagram_manage_comments, instagram_manage_messages): the extension only reads, and a read-only token is safer if it ever leaks. If Meta ticks one back on by itself, leave it. Save.

You can ignore the **Redirect URL** and **Login URL** fields.

### 7.5 Add your Instagram account as a tester
1. Back in **Use cases > Customize > API setup with Unified login**, expand **2. Generate access tokens**.
2. Click **Add account**. In **Add people to your app**, under **Additional roles for this app**, choose **Instagram Tester**, search for your Instagram username, select it and click **Add**.
3. If Instagram sends a tester invite, accept it **in a web browser** (the app doesn't show it): instagram.com > Settings > Website permissions > Apps and websites > **Tester Invites** > Accept.
4. Refresh the Meta page. Your account appears under **Generate access tokens**.

### 7.6 Generate the token
1. Click **Generate token** next to your account.
2. On **Log into business tools from Meta**, choose **Continue with** the Facebook account your business portfolio is on. If your Instagram account isn't offered next, start again with **Continue with Instagram**.
3. On **Select the business assets to share**, choose your business portfolio and your Instagram account. Skip the ad account and any prompt to create one.
4. In **Token generated**, tick **I understand**, click **Copy**, then **Done**.

Meta shows the token **only once**; if you lose it, generate a new one. Keep it private: don't paste it into chats, emails or documents. This token (it starts with `EAA`) never expires.

### 7.7 Add it to the extension
1. Claude Desktop > **Settings > Extensions > Social Content > Configure**.
2. Paste it into **Instagram access token** and save. Leave **Instagram account ID** empty.
3. Ask Claude to "check my Instagram insights". It pulls your recent posts and saves them in your brand kit's `insights/` folder.

**Older apps:** if your Meta app still shows **API setup with Instagram login**, open it, click **Add account**, log in, then **Generate token**. That token starts with `IG` and lasts 60 days; the extension renews it every week on its own.

---

## 8. Make your first post

In Claude, choose the **create_posts** prompt with **days** set to 1 (or say "make one test post"). Here's what happens:

1. **Checks**: the brand kit is valid and Penpot is connected.
2. **Plan**: the rotation gives the day's topic and format; Claude picks an angle, featured subject, background, layout and reel style, and checks them against the post log and your repeat rules. If Instagram is connected, it reads your Insights first.
3. **Research**: every fact is checked against reliable sources; news is checked for being current.
4. **Writing**: the caption, Story, pinned comment, replies and reel lines, in your voice, checked against your writing rules (length, hashtags, questions, emoji, words you never use), then edited to remove AI-sounding patterns. The caption is scored by the AI-writing check, and any sentence that reads as AI-written is reworded (same facts, same voice) until it's under your target.
5. **Design**: the image is built in your Penpot file in your look, then exported to your brand kit's `output/` folder. Claude looks at it and fixes anything off.
6. **Reel**: the image is animated in the chosen style; Claude checks frames from it.
7. **Log**: the post is added to `history.jsonl`.
8. **Delivery**: you get the image, the reel and every piece of text, with sources.

Look it over and tell Claude what to change. Changes to your look, voice or rules are saved to your brand kit, so every later batch gets them right.

---

## 9. Making posts from now on

- Ask for a batch ("make next week's posts", or the **create_posts** prompt with a start date and number of days, up to 14). With no start date, it continues the day after your last logged post.
- Each post in a batch gets its own reel style, and the batch is checked as a whole so openings, lengths and endings vary.
- Finished files are in your brand kit's `output/` folder: `NN_date_topic_format.png` and `..._reel.mp4`. Check frames for each reel are in `output/checks/`.
- Every design stays editable in your Penpot file.
- Reels have a silent sound track on purpose: add a sound in Instagram when you post. Business accounts can only use Instagram's commercial-use music, so the music suggestions are search terms, not song names.
- You post everything yourself.

---

## 10. Reference

### Brand kit folder

| File or folder | What it's for |
|---|---|
| `brand.yaml` | Who you are, how you write, how posts look, the reel note style |
| `pillars.yaml` | Topics, formats and angles, backgrounds, layouts, reel styles, repeat rules |
| `logo/` | Your logo (a transparent PNG), shown at the end of every reel |
| `style/` | Example posts; the look to follow |
| `assets/` | Your own photos and backgrounds |
| `voice/` | Past captions and writing notes, read before every batch |
| `fonts/` | Optional font files for reel notes (.ttf, .otf, .woff, .woff2) |
| `history.jsonl` | The post log (written by the extension) |
| `insights/` | Instagram Insights pulls (written by the extension) |
| `output/` | Finished images and reels, and reel check frames |

### brand.yaml

| Setting | What it does |
|---|---|
| `name`, `handle`, `about` | Who the brand is and who follows it |
| `platforms` | Where you post (instagram, facebook, tiktok, threads) |
| `voice` | How captions sound, in a few words |
| `never_mention` | Words and subjects no caption may contain |
| `hashtags` | Fewest and most hashtags per caption |
| `caption_words` | Shortest and longest caption, in words |
| `ai_score_target` | The AI-writing check's score captions must get under, as a fraction (0.15 = 15%) |
| `writing.emoji`, `writing.dashes` | Whether emoji and em or en dashes are allowed |
| `writing.max_questions` | Most questions in one caption |
| `writing.rules` | Any other rules, in plain words |
| `design.look` | How posts look, in plain words |
| `design.colors`, `design.fonts` | Brand colors (hex codes) and heading and body fonts |
| `design.avoid` | Things never to use in images |
| `design.penpot_file` | The Penpot file posts are built in |
| `reel.note` | The reel notes: `style` (card, paper or plain), `font`, `background` and `text` colors, `tape`, `tape_color` |

### pillars.yaml

| Setting | What it does |
|---|---|
| `anchor_date` | Day 0 of the rotation |
| `topics` | Subjects to rotate through; day N gets the next one |
| `formats` | Kinds of post, each with `angles` to choose from and optionally the `reel_styles` that suit it |
| `backgrounds` | Named backgrounds (a URL or a file in `assets/`) with the text colors that read on them |
| `layouts` | Named arrangements of subject and text |
| `reel_styles` | Which of the 14 styles to use (default all) |
| `rules` | `angle_cooldown_days` (42), `subject_cooldown_days` (30), `background_max_in_7` (2) |

### Reel styles

Every reel opens with its style's entrance (about 4 seconds), plays 3 to 7 close-ups with a short note over each, and ends on your logo. Direction changes from post to post, so the same style never moves identically twice.

| Style | How it moves | Suits |
|---|---|---|
| pushin | pops in, slow push-in | anything |
| slide | slides in from the side | comparisons |
| pan | starts close on the subject, pulls back | facts, details |
| drop | drops in with a bounce | opinions |
| shine | light sweeps across | launches, highlights |
| flip | flips over like a card | reveals, guessing |
| rise | floats up | history, nostalgia |
| spin | spins in | rankings |
| focus | pulls into focus | stories, background |
| deal | flicked in from a corner | picks, builds |
| wipe | soft top-down reveal | news, events |
| scan | reads down from the heading | text-heavy posts |
| flash | camera flash | moments, wins |
| handheld | phone-filmed drift | casual, behind the scenes |

---

## 11. Troubleshooting

**Install and settings**
- *A warning next to your operating system under Requirements*: you downloaded another platform's file. Get the one for your computer (step 3).
- *Claude says the brand kit has problems*: ask Claude to fix them with the setup interview; it explains each one.

**Penpot and the keeper**
- *A Penpot window opened by itself*: Penpot wants you to sign in again. Sign in there; it goes back to running hidden.
- *Claude says Penpot isn't connected*: ask Claude for the keeper's status. It usually reconnects within a minute on its own. If it says the keeper is paused, delete the `PAUSE` file in `.social-content-mcp/keeper`.
- *Still stuck*: turn Social Content off and on in Settings > Extensions; the keeper starts fresh.

**AI-writing check**
- *"The AI detector is downloading"*: the model downloads once (about 450 MB); try again in a few minutes.
- *"The download failed"*: ask Claude to retry the AI detector download; it verifies the file when it's done. Check your internet connection if it keeps failing.
- *"Couldn't start on this computer"*: update or reinstall the extension. Posts aren't delivered as finished until their captions are scored.
- *Scoring is slower on an Intel Mac*: the detector runs on a slower engine there (WebAssembly); the scores are the same.

**Instagram**
- *"The token isn't allowed to read insights" or "(#10) Application does not have permission"*: the configuration is missing **instagram_manage_insights**. Add it (7.3 and 7.4), generate a new token, paste it in.
- *instagram_manage_insights isn't in the configuration's list*: add it to the app first (7.3), then edit the configuration again.
- *Your account isn't listed under Generate access tokens*: accept the tester invite on instagram.com in a browser, then refresh.
- *Your Instagram account isn't offered when sharing assets*: make sure it's a professional account and in your business portfolio (business.facebook.com > Settings > Accounts > Instagram accounts), or use **Continue with Instagram**.
- *A blank page or "Invalid code" after logging in*: close it, refresh the Meta page and click **Generate token** again.
- *"Instagram rejected the token"*: it was revoked, the app was removed from your portfolio, or the account moved to another portfolio. Generate a new one.
- *An error mentioning `${user_config.instagram_account_id}`*: update the extension to 0.3.2 or later.
- *The numbers look low or empty*: insights can take up to 48 hours to appear, posts under 48 hours old are left out of comparisons, and small accounts get hints rather than proof.

---

## 12. Updating, privacy and turning things off

**Updating**: download the newer `.mcpb` from the releases page and double-click it. Claude Desktop updates the extension and keeps your settings; restart Claude Desktop afterwards. Your brand kit, post log and Penpot file aren't touched.

**What it can reach**: your brand kit folder, Penpot (with your key), Instagram Insights (read-only, if you add a token), the extension's GitHub releases (to download the AI-writing check's model once), and the websites Claude uses for research. Images, reels and AI scores are made on your computer; your captions aren't sent anywhere to be scored. Nothing is posted anywhere.

**Turning things off**
- Instagram: remove the token from the settings. To revoke it entirely, remove the app in Instagram (Settings > Website permissions > Apps and websites) or delete it on developers.facebook.com.
- Penpot: remove the MCP key, or turn the MCP server off in Penpot (Your account > Integrations).
- The keeper: turn off **Auto-start keeper**.
- Everything: turn the extension off or uninstall it in Settings > Extensions. Your brand kit folder stays where it is.

Facebook Page insights aren't read yet; Insights covers Instagram only.
