const puppeteer = require('puppeteer');
const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');
const path = require('path');
const fs = require('fs');
const { OpenAI } = require('openai');
const dotenv = require('dotenv');
dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ————— AI Helpers —————

async function extractColorsFromImage(base64Image) {
  const res = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{
      role: 'user',
      content: [
        {
          type: 'text', text:
            `From this screenshot, extract brand colors as HEX and label them as:\n` +
            `- background\n- container\n- accent\n- buttonText\n- foreground\n` +
            `Give only a JSON object with keys and hex values.`
        },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${base64Image}` } }
      ]
    }],
    max_tokens: 300
  });
  const match = res.choices[0]?.message?.content?.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); }
    catch { /* ignore */ }
  }
  return {};
}

async function generateBrandSummary(title, description, bodyText) {
  const fullText = `${title}\n${description}\n${bodyText}`;
  const res = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content:
          `Read the following content and summarize the brand in 2–3 sentences as if writing a ` +
          `brand profile for a design system. Begin with the brand name, then add key specifics. ` +
          `Keep the original wording as close as possible and avoid generic fluff:\n\n` +
          fullText
      }
    ],
    max_tokens: 300
  });
  return res.choices[0]?.message?.content?.trim() || '';
}
// ————— Scraper —————

async function scrapeBrandKitFromUrl(inputUrl) {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(inputUrl, { waitUntil: 'networkidle2' });

  const screenshotPath = path.resolve(__dirname, 'screenshot.png');
  await page.screenshot({ path: screenshotPath, fullPage: false });

  // 3) grab raw HTML + readability text
  const html = await page.content();
  const dom = new JSDOM(html, { url: inputUrl });
  const article = new Readability(dom.window.document).parse();

  // 4) metadata extraction
  const metadata = await page.evaluate(() => {
    const getMeta = (n) =>
      document.querySelector(`meta[name="${n}"]`)?.content ||
      document.querySelector(`meta[property="og:${n}"]`)?.content ||
      document.querySelector(`meta[name="twitter:${n}"]`)?.content ||
      '';
    const getLink = (rel) => document.querySelector(`link[rel="${rel}"]`)?.href || '';
    const styles = getComputedStyle(document.body);
    const socials = Array.from(
      document.querySelectorAll('a[href*="linkedin.com"], a[href*="twitter.com"], a[href*="facebook.com"]')
    ).map(a => ({ platform: a.href.match(/linkedin/) ? 'LinkedIn' : a.href.match(/twitter/) ? 'Twitter' : 'Facebook', url: a.href }))
      .filter((s, i, arr) => arr.findIndex(x => x.url === s.url) === i);

    const footerEl = document.querySelector('footer')?.innerText.trim().split('\n')[0] || '';
    const bodyText = document.body.innerText;
    const copyMatch = footerEl.match(/©[^\n]+/) || bodyText.match(/©[^\n]+/);
    const inferredCopyright = footerEl.match(/\b(Inc|LLC|Ltd|rights reserved)\b/i)?.[0] || (copyMatch ? copyMatch[0] : '');
    const explicitDisclaimers = Array.from(document.querySelectorAll('p, div'))
      .filter(el => /disclaimer/i.test(el.innerText))
      .map(el => el.innerText.trim())
      .join('\n');

    return {
      kitName: document.title || getMeta('title'),
      website: window.location.origin,
      brandSummary: getMeta('description'),
      primaryLogo: getLink('icon') || getMeta('image'),
      iconLogo: getLink('apple-touch-icon') || getMeta('image'),
      background: styles.backgroundColor,
      foreground: styles.color,
      socials,
      footerText: footerEl,
      copyright: inferredCopyright,
      disclaimers: explicitDisclaimers,
      title: document.title,
      description: getMeta('description'),
      bodyText
    };
  });

  // 5) assemble
  const result = {
    inputUrl,
    kitName: metadata.kitName,
    website: metadata.website,
    brandSummary: metadata.brandSummary,
    toneOfVoice: 'Neutral',
    address: '',
    socials: metadata.socials,
    logos: { primary: metadata.primaryLogo, icon: metadata.iconLogo },
    colors: {
      background: metadata.background,
      container: '',     // will be filled by AI
      accent: '',
      buttonText: '',
      foreground: metadata.foreground
    },
    content: {
      footer: metadata.footerText,
      copyright: metadata.copyright,
      disclaimers: metadata.disclaimers
    }
  };

  // 6) run AI color extractor
  try {
    const base64Image = fs.readFileSync(screenshotPath, 'base64');
    const aiColors = await extractColorsFromImage(base64Image);
    Object.assign(result.colors, aiColors);
  } catch (err) {
    console.error('Color extraction error:', err);
  }

  // 7) run AI summary
  try {
    const textContent = article?.textContent || metadata.brandSummary || '';
    result.brandSummary = await generateBrandSummary(textContent);
  } catch (err) {
    console.error('Summary generation error:', err);
  }

  await browser.close();

  // 8) write JSON
  const outputPath = path.resolve(__dirname, 'brandkit.json');
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`Saved brand kit to ${outputPath}`);

  return result;
}

// ————— Entry Point —————

const url = process.argv[2];
if (!url) {
  console.error('Usage: node scrape.js <URL>');
  process.exit(1);
}

scrapeBrandKitFromUrl(url)
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
