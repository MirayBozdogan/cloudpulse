// First monitor: check our own website from AWS.
const WEBSITE_URL = 'https://d61mkgexvp9pd.cloudfront.net/';

// Function URLs expect the result inside an HTTP response body.
const jsonResponse = (result) => ({
  statusCode: 200,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(result),
});

export const handler = async () => {
  const startedAt = performance.now();
  const checkedAt = new Date().toISOString();

  try {
    const response = await fetch(WEBSITE_URL, {
      method: 'HEAD',
      signal: AbortSignal.timeout(2000),
    });

    return jsonResponse({
      url: WEBSITE_URL,
      status: response.ok ? 'Operational' : 'HTTP error',
      statusCode: response.status,
      responseTimeMs: Math.round(performance.now() - startedAt),
      checkedAt,
    });
  } catch (error) {
    return jsonResponse({
      url: WEBSITE_URL,
      status: 'Unreachable',
      statusCode: null,
      responseTimeMs: Math.round(performance.now() - startedAt),
      checkedAt,
      error: error.name === 'TimeoutError' ? 'Request timed out' : 'Request failed',
    });
  }
};
