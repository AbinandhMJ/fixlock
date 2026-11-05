# Publishing fixlock

## One-time setup
1. Create an account at https://www.npmjs.com/signup and enable 2FA.
2. Create a public GitHub repo: AbinandhMJ/fixlock
3. From this folder:
   git init && git add . && git commit -m "fixlock v0.1.0"
   git branch -M main
   git remote add origin https://github.com/AbinandhMJ/fixlock.git
   git push -u origin main

## Publish
   npm login
   npm publish            # runs the e2e test first (prepublishOnly)
   git tag v0.1.0 && git push --tags

Check it: https://www.npmjs.com/package/fixlock  and  npx fixlock --help

## Next releases
   npm version patch      # or minor / major — bumps package.json and tags
   npm publish
   git push --follow-tags
