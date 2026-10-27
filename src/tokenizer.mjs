import { spawn } from 'node:child_process';

export async function tokenizeTexts(binary, dictionary, texts) {
  if (texts.length === 0) return [];
  const child = spawn(binary, ['--dict', dictionary], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    if (stdout.length > 64 * 1024 * 1024) child.kill('SIGKILL');
  });
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-32_768); });
  child.stdin.end(JSON.stringify({ texts }));
  const { code, signal } = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (exitCode, exitSignal) => resolve({ code: exitCode, signal: exitSignal }));
  });
  if (code !== 0) throw new Error(`tokenizer failed (${signal ?? code}): ${stderr}`);
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`tokenizer returned invalid JSON: ${error.message}`);
  }
  if (!parsed || !Array.isArray(parsed.tokens) || parsed.tokens.length !== texts.length) {
    throw new Error('tokenizer output must contain one token array per input text');
  }
  parsed.tokens.forEach((tokens, textIndex) => validateTokens(tokens, texts[textIndex], textIndex));
  return parsed.tokens;
}

function validateTokens(tokens, text, textIndex) {
  if (!Array.isArray(tokens)) throw new Error(`tokenizer tokens[${textIndex}] must be an array`);
  const byteLength = Buffer.byteLength(text);
  let previousEnd = 0;
  for (const [tokenIndex, token] of tokens.entries()) {
    if (typeof token?.word !== 'string'
      || !Number.isInteger(token.startByte)
      || !Number.isInteger(token.endByte)
      || token.startByte < previousEnd
      || token.endByte <= token.startByte
      || token.endByte > byteLength) {
      throw new Error(`invalid tokenizer token at tokens[${textIndex}][${tokenIndex}]`);
    }
    previousEnd = token.endByte;
  }
}
