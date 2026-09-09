import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import rootPkg from '../../package.json';

const BANNED_DEPS = [
  'openai',
  '@anthropic-ai/sdk',
  'langchain',
  'ollama',
  '@google/generative-ai',
];

const BANNED_SOURCE = [/openai/i, /anthropic/i, /langchain/i, /chatgpt/i];

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'qa') continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      collectSourceFiles(path, acc);
      continue;
    }
    if (/\.(tsx?|jsx?)$/.test(entry)) acc.push(path);
  }
  return acc;
}

describe('V1 blacklist (091)', () => {
  it('has no LLM SDKs in dependencies', () => {
    const deps = {
      ...rootPkg.dependencies,
      ...rootPkg.devDependencies,
    };
    for (const banned of BANNED_DEPS) {
      expect(deps).not.toHaveProperty(banned);
    }
  });

  it('has no banned patterns in src/', () => {
    const files = collectSourceFiles('src');
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      for (const pattern of BANNED_SOURCE) {
        expect(content, `${file} matches ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});
