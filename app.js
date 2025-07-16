const puppeteer = require('puppeteer');
const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');
const path = require('path');
const fs = require('fs');
const { OpenAI } = require('openai');
const dotenv = require('dotenv');
dotenv.config();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function extractColorsFromImage(base64Image) {
  const res = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Analyze the screenshot visually and extract the dominant brand colors and gradients as HEX or CSS gradient values. Based on visual layout, assign colors to:
- background (main canvas color)
- container (main content area)
- accent (used for highlights, links, buttons)
- buttonText (high-contrast readable text on buttons)
- foreground (default text)

If any sections use a gradient, specify it as a CSS linear-gradient string.
Return only a valid JSON object.`
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:image/png;base64,${base64Image}`
            }
          }
        ]
      }
    ],
    max_tokens: 500
  });

  console.log(res);
  console.log(res.choices[0]?.message?.content);

  const match = res.choices[0]?.message?.content?.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch {
      return {};
    }
  }
  return {};
}

async function generateBrandSummary(text) {
  const res = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: `Read the following content and summarize the brand in 2-3 sentences as if writing a brand profile for a design system. Avoid generic fluff. Be clear and specific:

${text}`
      }
    ],
    max_tokens: 300
  });

  return res.choices[0]?.message?.content?.trim() || '';
}

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
      background: '',
      container: '',
      accent: '',
      buttonText: '',
      foreground: ''
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
    const base64Image = fs.readFileSync(screenshotPath, { encoding: 'base64' });
    const aiColors = await extractColorsFromImage(base64Image);
    result.colors = { ...result.colors, ...aiColors };
  } catch (e) {
    console.error('Error extracting AI colors:', e.message);
  }

  try {
    const textContent = article?.textContent || metadata.brandSummary || '';
    result.brandSummary = await generateBrandSummary(textContent);
  } catch (e) {
    console.error('Error generating summary:', e.message);
  }

  await browser.close();

  const outputPath = path.resolve(__dirname, 'brandkit.json');
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));

  return { ...result, screenshotPath, extractedArticle: article?.textContent || '' };
}

scrapeBrandKitFromUrl('https://netzylo.com')
  .then(console.log)
  .catch(console.error);

module.exports = { scrapeBrandKitFromUrl };
