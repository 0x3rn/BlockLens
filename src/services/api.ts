import axios from 'axios';

const BASE_URL = 'https://api.coingecko.com/api/v3';

export const fetchMarketData = async () => {
  const response = await axios.get(`${BASE_URL}/coins/markets`, {
    params: {
      vs_currency: 'usd',
      order: 'market_cap_desc',
      per_page: 100,
      page: 1,
      sparkline: false,
    },
  });
  return response.data;
};

export const fetchCoinHistory = async (coinId: string, days: number = 7) => {
  const response = await axios.get(`${BASE_URL}/coins/${coinId}/market_chart`, {
    params: {
      vs_currency: 'usd',
      days: days,
    },
  });
  // Transform [timestamp, price] array into object array for Recharts
  return response.data.prices.map((price: [number, number]) => ({
    timestamp: price[0],
    price: price[1],
  }));
};

export const fetchMarketMetrics = async () => {
  try {
    const response = await axios.get(`${BASE_URL}/global`);
    const globalData = response.data.data;
    const spotVolume = globalData.total_volume.usd;

    // Simulate Futures and Liquidations based on spot volume for demonstration
    // Real-time liquidation APIs require premium keys or websocket feeds.
    const futuresVolume = spotVolume * 1.8; // Futures volume is typically higher
    const openInterest = futuresVolume * 0.15;
    const longLiq = (spotVolume * 0.002) * (0.3 + Math.random() * 0.7);
    const shortLiq = (spotVolume * 0.002) * (0.3 + Math.random() * 0.7);

    return {
      spotVolume24h: spotVolume,
      futuresVolume24h: futuresVolume,
      openInterest: openInterest,
      longLiquidations24h: longLiq,
      shortLiquidations24h: shortLiq,
    };
  } catch (err) {
    console.error("Failed to fetch global metrics", err);
    return null;
  }
};

export const fetchCoinDetail = async (coinId: string) => {
  const response = await axios.get(`${BASE_URL}/coins/${coinId}`, {
    params: {
      localization: false,
      tickers: false,
      community_data: false,
      developer_data: false,
      sparkline: false,
    },
  });
  return response.data;
};

export const generateAIAnalysis = async (
  coinName: string,
  price: number,
  change24h: number,
  chartData7d: { timestamp: number; price: number }[],
  chartData30d: { timestamp: number; price: number }[],
  chartData1y: { timestamp: number; price: number }[]
) => {
  const apiKey = process.env.REACT_APP_DEEPSEEK_API_KEY;
  if (!apiKey || apiKey === 'your_deepseek_api_key_here') {
    // Fallback to mock if API key is not configured
    await new Promise(res => setTimeout(res, 1500));
    const trend = change24h >= 0 ? "bullish" : "bearish";
    const strength = Math.abs(change24h) > 5 ? "strong" : Math.abs(change24h) > 2 ? "moderate" : "mild";
    return `${coinName} is exhibiting a ${strength} ${trend} bias with a 24h change of ${change24h.toFixed(2)}%. Current price: $${price.toLocaleString()}.\n\n⚠️ API Key Not Configured: Add your DeepSeek API key to .env for real-time AI futures analysis.\n\nRisk Level: ${Math.abs(change24h) > 5 ? 'High' : Math.abs(change24h) > 2 ? 'Medium' : 'Low'} — always size positions accordingly.`;
  }

  // Sample chart data points for the prompt (take representative samples to stay within token limits)
  const sample7d = sampleChartData(chartData7d, 20);
  const sample30d = sampleChartData(chartData30d, 20);
  const sample1y = sampleChartData(chartData1y, 30);

  const prompt = `You are an expert crypto futures trading analyst. Analyze the following real-time chart data for ${coinName} (current price: $${price.toLocaleString()}, 24h change: ${change24h.toFixed(2)}%) and provide a comprehensive futures trading recommendation.

PRICE HISTORY DATA:

7-Day Chart (close prices):
${sample7d.map(d => `  ${new Date(d.timestamp).toISOString().split('T')[0]}: $${d.price.toFixed(4)}`).join('\n')}

30-Day Chart (close prices):
${sample30d.map(d => `  ${new Date(d.timestamp).toISOString().split('T')[0]}: $${d.price.toFixed(4)}`).join('\n')}

1-Year Chart (close prices):
${sample1y.map(d => `  ${new Date(d.timestamp).toISOString().split('T')[0]}: $${d.price.toFixed(4)}`).join('\n')}

Based on the price action across these timeframes, provide a detailed analysis in the following format:

1. TREND ANALYSIS: Identify the overall trend (short, medium, and long-term). Note key support and resistance levels from the data.

2. TECHNICAL SIGNALS: Analyze price patterns, momentum, and potential reversal/continuation signals visible in the data.

3. FUTURES TRADING RECOMMENDATION: 
   - Give a clear LONG or SHORT recommendation for futures trading
   - Provide suggested entry price range
   - Suggest stop-loss level
   - Suggest take-profit targets (at least 2 levels)

4. RISK ASSESSMENT: Rate the risk level (Low/Medium/High) and explain why. Note any upcoming volatility concerns.

5. CONVICTION LEVEL: Rate your conviction in this trade setup from 1-10.

Keep the response concise but actionable. Format with clear section headers. Do NOT include generic disclaimers — I understand the risks of futures trading.`;

  try {
    const response = await axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      {
        model: 'deepseek-v4-pro',
        messages: [
          {
            role: 'system',
            content: 'You are a professional crypto futures trading analyst. You analyze real price data and provide actionable LONG/SHORT trading recommendations with specific entry, stop-loss, and take-profit levels. Be direct and specific.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.3,
        max_tokens: 1500,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
      }
    );

    return response.data.choices[0].message.content;
  } catch (err: any) {
    console.error('DeepSeek API error:', err?.response?.data || err);
    // Fall back to the mock analysis on API failure
    const trend = change24h >= 0 ? 'bullish' : 'bearish';
    const strength = Math.abs(change24h) > 5 ? 'strong' : Math.abs(change24h) > 2 ? 'moderate' : 'mild';
    return `${coinName} is exhibiting a ${strength} ${trend} bias with a 24h change of ${change24h.toFixed(2)}%. Current price: $${price.toLocaleString()}.\n\n⚠️ DeepSeek API Error: Falling back to basic analysis. Check your API key and network connection.\n\nRisk Level: ${Math.abs(change24h) > 5 ? 'High' : Math.abs(change24h) > 2 ? 'Medium' : 'Low'} — always size positions accordingly.`;
  }
};

// Helper: sample evenly-spaced data points from a chart array
const sampleChartData = (data: { timestamp: number; price: number }[], count: number) => {
  if (data.length <= count) return data;
  const step = Math.floor(data.length / count);
  const sampled: { timestamp: number; price: number }[] = [];
  for (let i = 0; i < data.length && sampled.length < count; i += step) {
    sampled.push(data[i]);
  }
  return sampled;
};
