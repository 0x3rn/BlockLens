import OpenAI from 'openai';
import { GoogleAuth } from 'google-auth-library';
import { processEnvironment, type ServerEnvironment } from './_env.ts';

// DEEPSEEK - DISABLED FOR NOW

// export function getDeepSeek() {
//   return new OpenAI({
//     apiKey: process.env.DEEPSEEK_API_KEY,
//     baseURL: 'https://api.deepseek.com',
//   });
// }

// GOOGLE VERTEX AI / GEMINI

export async function getGemini(environment: ServerEnvironment = processEnvironment()) {
  const projectId = environment.GOOGLE_CLOUD_PROJECT;
  const credentialsJson = environment.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (!projectId) {
    throw new Error('GOOGLE_CLOUD_PROJECT is not configured.');
  }

  if (!credentialsJson) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not configured.');
  }

  const credentials = JSON.parse(credentialsJson);
  const auth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const client = await auth.getClient();
  const accessToken = await client.getAccessToken();

  if (!accessToken.token) {
    throw new Error('Unable to obtain Google Cloud access token.');
  }

  return new OpenAI({
    apiKey: accessToken.token,
    baseURL:
      'https://aiplatform.googleapis.com/v1/'
      + `projects/${projectId}/locations/global/endpoints/openapi`,
  });
}
