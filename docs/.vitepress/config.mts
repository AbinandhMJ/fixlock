import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'fixlock',
  description: 'Stop fixed bugs and finished features from coming back.',
  base: '/fixlock/',
  cleanUrls: true,
  lastUpdated: false,
  rewrites: { 'README.md': 'index.md' },
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/fixlock/favicon.svg' }],
    ['meta', { property: 'og:title', content: 'fixlock — fixed stays fixed.' }],
    ['meta', { property: 'og:description', content: 'Stop fixed bugs and finished features from coming back.' }],
    ['meta', { property: 'og:image', content: 'https://abinandhmj.github.io/fixlock/social-preview.png' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
  ],
  themeConfig: {
    logo: { light: '/fixlock-mark.svg', dark: '/fixlock-mark-dark.svg', alt: 'fixlock' },
    nav: [
      { text: 'Get started', link: '/getting-started' },
      { text: 'Commands', link: '/cli-reference' },
    ],
    sidebar: [
      { text: 'Guides', items: [
        { text: 'Overview', link: '/' },
        { text: 'Getting started', link: '/getting-started' },
        { text: 'Team lead guide', link: '/team-lead-guide' },
        { text: 'Developer guide', link: '/developer-guide' },
        { text: 'AI tools', link: '/ai-tools' },
      ] },
      { text: 'Setup', items: [
        { text: 'CI setup', link: '/ci-setup' },
        { text: 'Issue trackers', link: '/trackers' },
      ] },
      { text: 'Reference', items: [
        { text: 'Configuration', link: '/configuration' },
        { text: 'Command reference', link: '/cli-reference' },
        { text: 'Troubleshooting', link: '/troubleshooting' },
      ] },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/AbinandhMJ/fixlock' },
      { icon: 'npm', link: 'https://www.npmjs.com/package/@abinandhmj/fixlock' },
    ],
    search: { provider: 'local' },
    outline: { level: [2, 3] },
    footer: { message: 'MIT licensed · npx @abinandhmj/fixlock init' },
  },
})
