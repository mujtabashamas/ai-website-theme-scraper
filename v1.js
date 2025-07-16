const puppeteer = require('puppeteer');
const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');
const path = require('path');
const fs = require('fs');
const { Vibrant } = require('node-vibrant/node');

/**
 * Scrapes a URL and returns extracted brand-like data based on industry standards
 */
async function scrapeBrandKitFromUrl(url) {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();

  await page.goto(url, { waitUntil: 'networkidle2' });
  const screenshotPath = path.resolve(__dirname, 'screenshot.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });

  const html = await page.content();
  const dom = new JSDOM(html, { url });
  const article = new Readability(dom.window.document).parse();

  const result = {
    kitName: '',
    website: '',
    brandSummary: '',
    toneOfVoice: 'Neutral',
    address: '',
    socials: [],
    logos: { primary: '', icon: '' },
    colors: {
      background: '',       // The main background of your email
      container: '',        // The content box of the email
      accent: '',           // Buttons, links, and highlights
      buttonText: '',       // Text on buttons
      foreground: ''        // Text and other content elements
    },
    content: { copyright: '', footer: '', disclaimers: '' }
  };

  const metadata = await page.evaluate(() => {
    const getMeta = (n) =>
      document.querySelector(`meta[name="${n}"]`)?.content ||
      document.querySelector(`meta[property="og:${n}"]`)?.content ||
      document.querySelector(`meta[name="twitter:${n}"]`)?.content ||
      '';

    const getLink = (rel) => document.querySelector(`link[rel="${rel}"]`)?.href || '';
    const bg = getComputedStyle(document.body).backgroundColor;
    const fg = getComputedStyle(document.body).color;

    let socials = Array.from(
      document.querySelectorAll('a[href*="linkedin.com"], a[href*="twitter.com"], a[href*="facebook.com"]')
    ).map((a) => ({
      platform: a.href.includes('linkedin') ? 'LinkedIn' : a.href.includes('twitter') ? 'Twitter' : 'Facebook',
      url: a.href
    }));

    socials = socials.filter((s, i, arr) => arr.findIndex((x) => x.url === s.url) === i);

    const footerEl = document.querySelector('footer')?.innerText.trim() || '';
    const bodyText = document.body.innerText;
    const copyMatch = footerEl.match(/©[^\n]+/) || bodyText.match(/©[^\n]+/);

    let inferredCopyright = '';
    let inferredDisclaimers = '';
    if (footerEl) {
      if (/\binc\b|llc|rights reserved/i.test(footerEl)) {
        inferredCopyright = footerEl;
      }
      if (/\bdisclaimer\b|data policy|not responsible|informational/i.test(footerEl)) {
        inferredDisclaimers = footerEl;
      }
    }

    const explicitDisclaimers = Array.from(document.querySelectorAll('p, div'))
      .filter((el) => /disclaimer/i.test(el.innerText))
      .map((el) => el.innerText.trim())
      .join('\n');

    return {
      kitName: document.title || getMeta('title'),
      website: window.location.origin,
      brandSummary: getMeta('description'),
      primaryLogo: getLink('icon') || getLink('shortcut icon') || getMeta('image'),
      iconLogo: getLink('apple-touch-icon') || getMeta('image'),
      background: bg,
      foreground: fg,
      socials,
      footerText: footerEl,
      copyright: inferredCopyright || (copyMatch ? copyMatch[0] : ''),
      disclaimers: inferredDisclaimers || explicitDisclaimers
    };
  });

  Object.assign(result, {
    kitName: metadata.kitName,
    website: metadata.website,
    brandSummary: article?.textContent || metadata.brandSummary,
    socials: metadata.socials,
    logos: { primary: metadata.primaryLogo, icon: metadata.iconLogo },
    colors: {
      ...result.colors,
      background: metadata.background,
      foreground: metadata.foreground
    },
    content: {
      footer: metadata.footerText,
      copyright: metadata.copyright,
      disclaimers: metadata.disclaimers
    }
  });

  try {
    const palette = await Vibrant.from(screenshotPath).getPalette();
    result.colors.accent = palette.Vibrant?.hex || '';
    result.colors.container = palette.LightVibrant?.hex || '';
    result.colors.buttonText = palette.DarkVibrant?.hex || '';
  } catch (e) {
    console.error('Error extracting colors:', e.message);
  }

  await browser.close();

  const outputPath = path.resolve(__dirname, 'brandkit.json');
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));

  return { ...result, screenshotPath, extractedArticle: article?.textContent || '' };
}

// Run for NetZylo
scrapeBrandKitFromUrl('https://netzylo.com')
  .then(console.log)
  .catch(console.error);

module.exports = { scrapeBrandKitFromUrl };
