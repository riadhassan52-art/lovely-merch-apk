# LoveLy Merch — Android APK

Native Android WebView wrapper app for **[https://merch.sadamata.com/dashboard](https://merch.sadamata.com/dashboard)** with automated GitHub Actions APK builds.

## Features
- **Persistent Login & Cookies** (stays signed in across restarts)
- **File Upload & Download Support** (supports images, multiple file uploads, direct downloads, and `blob:` / `data:` exports)
- **Native Pull-to-Refresh** (only triggers at the top of the page)
- **Branded Splash Screen & Adaptive Icon** (`#FF681D` LoveLy Merch branding)
- **Offline Fallback Screen** with one-tap Retry
- **Back Navigation** with double-back to exit
- **Deep Link Support** for `https://merch.sadamata.com/...` links

## How to Build & Download the APK on GitHub (No Local Setup Needed)

1. Go to [github.com/new](https://github.com/new) and create a new repository (e.g. `lovely-merch-apk`, Private or Public).
2. Click **"uploading an existing file"** on the empty repo page.
3. Open the `LoveLy-Merch-APK` folder on your PC, press **`Ctrl + A`** (make sure `.github` folder is included!), and drag everything into GitHub.
4. Click **"Commit changes"**.
5. Open the **Actions** tab in your GitHub repository — **Build LoveLy Merch APK** will run automatically (~2 minutes).
6. Once the green checkmark appears, go to **Releases** (right sidebar of your repo) and download **`LoveLy-Merch.apk`** directly on your phone and install!
