# £ to ₦ rate board (automatic)

A GitHub Action opens each platform every 30 minutes, reads the £ to ₦ rate and saves it to `rates.json`.
`index.html` (hosted on GitHub Pages) reads that file and ranks the platforms.

## Setup (about 10 minutes)
1. Create a free GitHub account, then a new **public** repository (e.g. `rate-board`).
2. Upload everything in this folder, including the hidden `.github` folder. The easiest way is GitHub Desktop, or
   `git init`, `git add .`, `git commit`, then `git push` from the unzipped folder.
3. Repository **Settings > Actions > General > Workflow permissions**: choose **Read and write permissions**, then Save.
4. Repository **Settings > Pages**: Source = **Deploy from a branch**, Branch = **main**, folder = **/ (root)**, Save.
5. Open the **Actions** tab, choose **Update rates**, click **Run workflow**. It takes a few minutes.
6. Your page will be at `https://<your-username>.github.io/<repo-name>/`.

## If a platform shows "Couldn't read automatically"
Open the finished run in the Actions tab and download the **debug** artifact. It holds a screenshot and the page text
for each platform. Send those to Claude and the selectors can be fixed. Until then, type that platform's rate into the page.

## Notes
- GitHub's scheduler can run a few minutes late, and it pauses after 60 days without repository activity.
- The rates are what each site shows on its public page. The final rate in the app can differ, so check it before sending.
- Check each platform's terms about automated access before relying on this.
