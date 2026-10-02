export function health(_request, response) {
  response.statusCode = 200;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  return response.end(JSON.stringify({ status: 'ok' }));
}

export default health;
