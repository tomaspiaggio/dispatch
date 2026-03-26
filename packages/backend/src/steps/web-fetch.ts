export async function webFetchStep(
  url: string,
  method: string = "GET",
  body?: string,
  headers?: Record<string, string>
) {
  "use step";
  const res = await fetch(url, {
    method,
    body: body ?? undefined,
    headers: headers ?? undefined,
  });
  const responseBody = await res.text();
  return {
    status: res.status,
    statusText: res.statusText,
    headers: Object.fromEntries(res.headers.entries()),
    body: responseBody.slice(0, 50000), // Cap response size
  };
}
