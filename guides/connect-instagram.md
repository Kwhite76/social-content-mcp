# Connect Instagram Insights

Social Content can read your Instagram Insights (reach, views, likes, comments, saves, shares, reel watch time, and how much of your reach comes from people who don't follow you yet) so every batch of posts learns from what did well. It only reads: it never posts, comments, likes, follows or changes anything on your account.

This takes about 15 minutes, once. You set up a small private "app" on Meta's developer site that only you use, generate an access token, and paste it into the extension's settings. You don't need App Review, and you never publish the app.

Meta changes these screens from time to time. If something on your screen doesn't match, look for the closest match, or ask Claude and share a screenshot.

## What you need

- **An Instagram professional account** (Business or Creator). In the Instagram app: Settings > Account type and tools > Switch to professional account. It's free.
- **A Facebook account.** You log in to Meta's developer site with it.
- **A business portfolio** (free). You can create one while making the app in step 2, or beforehand at business.facebook.com.

You do **not** need a Facebook Page.

## 1. Sign in to Meta for Developers

1. Go to developers.facebook.com and click **Get Started** (top right).
2. Log in with your Facebook account. If Meta asks you to register as a developer, follow its prompts (it may ask to confirm your phone number or email).

## 2. Create the app

1. Click **My Apps**, then **Create App**.
2. **App details:** any name (for example "Social Insights") and your email. Click **Next**.
3. **Use cases:** on the left, click **Content management**, then tick **Manage messaging & content on Instagram**. Leave everything else unticked. Click **Next**.
4. **Business:** connect your business portfolio. New apps need one.
5. Click through **Requirements** and **Overview**, then **Create app**. Leave the app in development ("Unpublished"); that's all you need to read your own account.

## 3. Add the insights permission to the app

1. On the app's **Dashboard**, click **Customize the Manage messaging & content on Instagram use case** (or go to **Use cases** and click **Customize** on it).
2. Open **Permissions and features**.
3. Find **instagram_manage_insights** and click **Add**. It should then show *Ready for testing*, as should **instagram_basic**.

## 4. Create the login configuration

1. In the same use case, open **API setup with Unified login**. A banner may say "API setup with Instagram login is not available for newer apps". That's expected: new apps use Unified login.
2. Under **1. Configure your app**, click **Create new configuration**, keep the defaults, and click **Create from template**. The configuration should show **Instagram Login Compatible** and **Selected**.
3. The template doesn't include insights, so edit it: in the left menu open **Facebook Login for Business > Configurations**, click **Edit** on the configuration, and go to **Permissions**.
4. Tick **instagram_basic** and **instagram_manage_insights**. Untick the rest (ads_management, ads_read, instagram_content_publish, instagram_manage_comments, instagram_manage_messages): the extension only reads, and a read-only token is safer. If Meta ticks one back on by itself, leave it. Save.

You can ignore the **Redirect URL** and **Login URL** fields.

## 5. Add your Instagram account as a tester

1. Go back to **Use cases > Customize > API setup with Unified login** and expand **2. Generate access tokens**.
2. Click **Add account**. In **Add people to your app**, under **Additional roles for this app**, choose **Instagram Tester**, search for your Instagram username, select it and click **Add**.
3. If Instagram sends a tester invite, accept it **in a web browser** (the Instagram app doesn't show it): instagram.com > Settings > Website permissions > Apps and websites > **Tester Invites** > Accept.
4. Refresh the Meta page. Your account appears under **Generate access tokens**.

## 6. Generate the token

1. Click **Generate token** next to your account.
2. On **Log into business tools from Meta**, choose **Continue with** your Facebook account (the one your business portfolio is on). If your Instagram account doesn't show up in the next step, start again and choose **Continue with Instagram** instead.
3. On **Select the business assets to share**, choose your business portfolio and your Instagram account. The ad account is optional: skip it, and skip any prompt to create one.
4. Click through to the end. In **Token generated**, tick **I understand**, click **Copy**, then **Done**.

**Meta shows the token only once.** If you lose it, generate a new one. Keep it private: don't paste it into chats, emails or documents.

This token (it starts with `EAA`) never expires.

## 7. Paste it into the extension

1. In Claude Desktop: **Settings > Extensions > Social Content > Configure**.
2. Paste the token into **Instagram access token** and save. Leave **Instagram account ID** empty unless your token can see more than one Instagram account.
3. Ask Claude to "check my Instagram insights". It pulls your recent posts and saves the results in your brand kit's `insights/` folder.

## Older apps: "API setup with Instagram login"

If your app was created before Meta switched to Unified login and still shows **API setup with Instagram login**: open it, click **Add account** under **Generate access tokens**, log in, then **Generate token**. That token starts with `IG` and lasts 60 days; the extension renews it every week on its own, so you don't have to.

## If something goes wrong

- **"The token isn't allowed to read insights" or "(#10) Application does not have permission"**: the configuration is missing **instagram_manage_insights**. Add it (step 3, then step 4.3 to 4.4), generate a new token, and paste it in.
- **The permission isn't in the configuration's list:** add it to the app first (step 3), then edit the configuration again.
- **Your account isn't listed under Generate access tokens:** accept the tester invite on instagram.com in a browser, then refresh.
- **Your Instagram account isn't offered when sharing assets:** make sure it's a professional account and belongs to your business portfolio (business.facebook.com > Settings > Accounts > Instagram accounts), or use **Continue with Instagram**.
- **A blank page or "Invalid code" after logging in:** close it, refresh the Meta page and click **Generate token** again.
- **"Instagram rejected the token":** it was revoked, the app was removed from your portfolio, or the account moved to another portfolio. Generate a new one.
- **An error mentioning `${user_config.instagram_account_id}`:** update the extension to 0.3.2 or later.
- **The numbers look low or empty:** insights can take up to 48 hours to appear, posts under 48 hours old are left out of comparisons, and small accounts get hints rather than proof.

## Turning it off

Remove the token from the extension's settings. To revoke it entirely, remove the app in Instagram (Settings > Website permissions > Apps and websites) or delete it on developers.facebook.com.

Facebook Page insights aren't read yet; this connects Instagram only.
