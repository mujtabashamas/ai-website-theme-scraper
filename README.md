# AI Website Theme Scraper

An advanced website theme extraction tool that uses AI to analyze and extract brand elements from any website. This tool provides more comprehensive and accurate results than similar services like new.email.

## Features

- **Brand Color Extraction**: Uses GPT-4o Vision to identify and extract key brand colors including background, container, accent, button text, and foreground colors in HEX format
- **Brand Summary Generation**: Creates concise brand summaries using AI analysis of website content
- **Logo Detection**: Extracts primary and icon logos from websites
- **Social Media Links**: Automatically detects and categorizes social media profiles
- **Content Analysis**: Extracts copyright information, footer text, and disclaimers
- **Screenshot Capture**: Takes screenshots of websites for visual reference

## Usage

```bash
node app.js <website-url>
```

Example:
```bash
node app.js https://example.com
```

## Output

The tool generates a comprehensive `brandkit.json` file containing:

- Website metadata (name, URL, summary)
- Brand colors in HEX format
- Logo URLs
- Social media links
- Content elements (copyright, footer text, disclaimers)

## Requirements

- Node.js
- OpenAI API key (set in `.env` file)
- Required npm packages (puppeteer, jsdom, openai, etc.)

## Advantages Over new.email

- Uses advanced AI vision models for more accurate color extraction
- Provides more comprehensive brand summaries
- Extracts a wider range of brand elements
- Fully customizable and extendable
- No rate limits or subscription fees (beyond OpenAI API costs)
- Open source and self-hosted