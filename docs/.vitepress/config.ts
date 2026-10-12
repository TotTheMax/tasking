import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitepress";

export const defaultLocale = "zh" as const;

type LocaleCode = "zh" | "en";
const other: LocaleCode = defaultLocale === "zh" ? "en" : "zh";
const isZh = (code: LocaleCode): boolean => code === "zh";

const here = dirname(fileURLToPath(import.meta.url));
const zhSlugs = readdirSync(join(here, "..", "zh"))
  .filter((f) => f.endsWith(".md"))
  .map((f) => f.replace(/\.md$/, ""));

const rewrites: Record<string, string> = {};
for (const slug of zhSlugs) {
  rewrites[`${defaultLocale}/${slug}.md`] = `${slug}.md`;
}

interface NavEntry {
  slug: string;
  zh: string;
  en: string;
}

const NAV: NavEntry[] = [
  { slug: "getting-started", zh: "快速上手", en: "Getting Started" },
  { slug: "usage", zh: "使用指南", en: "Usage" },
  { slug: "configuration", zh: "配置参考", en: "Configuration" },
  { slug: "architecture", zh: "架构概览", en: "Architecture" },
  { slug: "development", zh: "开发指南", en: "Development" },
  { slug: "feishu-quickstart", zh: "飞书接入", en: "Feishu" },
];

function nav(code: LocaleCode) {
  const prefix = code === defaultLocale ? "" : `/${code}/`;
  return NAV.map((n) => ({ text: n[code], link: `${prefix}${n.slug}` }));
}

function sidebar(code: LocaleCode) {
  const prefix = code === defaultLocale ? "" : `/${code}/`;
  const link = (slug: string): string => `${prefix}${slug}`;
  const label = (zh: string, en: string): string => (isZh(code) ? zh : en);
  return [
    {
      text: label("开始", "Start"),
      items: [
        { text: label("快速上手", "Getting Started"), link: link("getting-started") },
        { text: label("文档索引", "Index"), link: link("index") },
      ],
    },
    {
      text: label("使用", "Usage"),
      items: [
        { text: label("使用指南", "Usage"), link: link("usage") },
        { text: label("配置参考", "Configuration"), link: link("configuration") },
        { text: label("飞书接入", "Feishu Quickstart"), link: link("feishu-quickstart") },
        { text: label("飞书应用开通", "Feishu App Setup"), link: link("feishu-app-setup") },
      ],
    },
    {
      text: label("深入", "Deep Dives"),
      items: [
        { text: label("架构概览", "Architecture"), link: link("architecture") },
        { text: label("状态流转", "State Flow"), link: link("state-flow") },
        { text: label("超时模型", "Timeout Model"), link: link("timeout-model") },
        { text: label("技能系统", "Skills"), link: link("skills") },
      ],
    },
    {
      text: label("其他", "More"),
      items: [
        { text: label("开发指南", "Development"), link: link("development") },
        { text: label("已知问题", "Known Issues"), link: link("known-issues") },
        { text: label("日志", "Logging"), link: link("logging") },
        { text: label("Token 计费", "Token Accounting"), link: link("token-accounting") },
      ],
    },
  ];
}

function localeTheme(code: LocaleCode) {
  return {
    label: isZh(code) ? "简体中文" : "English",
    lang: isZh(code) ? "zh-CN" : "en-US",
    themeConfig: {
      nav: nav(code),
      sidebar: sidebar(code),
      outline: { label: isZh(code) ? "本页导航" : "On this page" },
      docFooter: {
        prev: isZh(code) ? "上一页" : "Previous",
        next: isZh(code) ? "下一页" : "Next",
      },
      lastUpdated: { text: isZh(code) ? "最后更新" : "Last updated" },
    },
  };
}

export default defineConfig({
  title: "tasking",
  description:
    "A TypeScript CLI daemon orchestrating opencode coding-agent work from Jira and Feishu.",
  lang: isZh(defaultLocale) ? "zh-CN" : "en-US",
  ignoreDeadLinks: [/\.\.\//],
  rewrites,
  locales: {
    root: localeTheme(defaultLocale),
    [other]: {
      ...localeTheme(other),
      link: `/${other}/`,
    },
  },
  themeConfig: {
    socialLinks: [{ icon: "github", link: "https://github.com/TotTheMax/tasking" }],
  },
});
