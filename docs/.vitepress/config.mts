import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'fixlock',
  description: 'Stop AI coding assistants and teammates from silently undoing bug fixes. Works with Claude Code, Cursor, GitHub Copilot and Codex via MCP.',
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
      { text: 'Demo', link: '/demo' },
      { text: 'Get started', link: '/getting-started' },
      { text: 'AI assistants', link: '/integrations/' },
      { text: 'Commands', link: '/cli-reference' },
    ],
    sidebar: [
      { text: 'Start here', items: [
        { text: 'Overview', link: '/' },
        { text: 'See it in action', link: '/demo' },
        { text: 'How it works', link: '/how-it-works' },
        { text: 'Getting started', link: '/getting-started' },
      ] },
      { text: 'Guides', items: [
        { text: 'Team lead guide', link: '/team-lead-guide' },
        { text: 'Developer guide', link: '/developer-guide' },
        { text: 'AI tools', link: '/ai-tools' },
      ] },
      { text: 'AI assistants', items: [
        { text: 'Overview', link: '/integrations/' },
        { text: 'VS Code extension', link: '/integrations/vscode' },
        { text: 'Claude Code', link: '/integrations/claude-code' },
        { text: 'Cursor', link: '/integrations/cursor' },
        { text: 'GitHub Copilot', link: '/integrations/copilot' },
        { text: 'OpenAI Codex', link: '/integrations/codex' },
        { text: 'MCP server reference', link: '/integrations/mcp' },
      ] },
      { text: 'Setup', items: [
        { text: 'CI setup', link: '/ci-setup' },
        { text: 'Issue trackers', link: '/trackers' },
        { text: 'Examples', link: '/examples' },
      ] },
      { text: 'Help', items: [
        { text: 'Recipes', link: '/recipes' },
        { text: 'FAQ', link: '/faq' },
      ] },
      { text: 'Reference', items: [
        { text: 'Configuration', link: '/configuration' },
        { text: 'Command reference', link: '/cli-reference' },
        { text: 'Troubleshooting', link: '/troubleshooting' },
        { text: 'Security & privacy', link: '/security' },
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
