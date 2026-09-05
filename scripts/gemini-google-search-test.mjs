import OpenAI from 'openai';
import { GoogleAuth } from 'google-auth-library';

const projectId = process.env.GOOGLE_CLOUD_PROJECT?.trim();
const credentialsJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();

if (!projectId || !credentialsJson) {
  console.error('Missing GOOGLE_CLOUD_PROJECT or GOOGLE_SERVICE_ACCOUNT_JSON.');
  console.error('Run with: node --env-file=.env.local scripts/gemini-google-search-test.mjs');
  process.exitCode = 1;
} else {
  let credentials;
  try {
    credentials = JSON.parse(credentialsJson);
  } catch {
    console.error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.');
    process.exitCode = 1;
  }

  if (credentials) {
    const auth = new GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    const accessToken = await (await auth.getClient()).getAccessToken();

    if (!accessToken.token) {
      throw new Error('Unable to obtain a Google Cloud access token.');
    }

    const gemini = new OpenAI({
      apiKey: accessToken.token,
      baseURL: `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/global/endpoints/openapi`,
    });

    const testedAt = new Date().toISOString();
    const completion = await gemini.chat.completions.create({
      model: 'google/gemini-3.1-pro-preview',
      messages: [{
        role: 'user',
        content: `Search Google for the current Brent crude oil price and the latest news on Iran. This is a live-search verification run at ${testedAt}. State the Brent price, currency, contract/reference, and retrieval time. Summarize the three newest material Iran developments, each with its publication/event date and source URL. Do not rely on training data; use Google Search.`,
      }],
      temperature: 0,
      // Vertex AI maps this OpenAI-compatible field to Gemini's Google Search tool.
      web_search_options: {},
    });

    const response = completion;
    const grounding = response.grounding_metadata ?? response.groundingMetadata;
    const citations = response.citations ?? grounding?.grounding_chunks ?? grounding?.groundingChunks ?? [];

    console.log(`Gemini Google Search test — requested at ${testedAt}`);
    console.log('');
    console.log(response.choices?.[0]?.message?.content ?? '(No text returned.)');
    console.log('');
    console.log(`Grounding metadata returned: ${grounding ? 'yes' : 'no'}`);

    if (grounding?.web_search_queries ?? grounding?.webSearchQueries) {
      console.log('Google queries:', JSON.stringify(grounding.web_search_queries ?? grounding.webSearchQueries));
    }
    if (Array.isArray(citations) && citations.length > 0) {
      console.log('Grounding sources:');
      for (const citation of citations) {
        const web = citation.web ?? citation;
        const url = web.uri ?? web.url;
        if (url) console.log(`- ${web.title ?? url}: ${url}`);
      }
    }

    if (!grounding) {
      console.error('FAILED: Gemini returned no grounding metadata, so this run cannot verify live Google Search was used.');
      process.exitCode = 2;
    }
  }
}
