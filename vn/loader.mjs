import { inspectScript, scriptSignature } from './compatibility.mjs';

export class LoadError extends Error {
  constructor(code, detail, retryable = false) {
    super(detail); this.code = code; this.retryable = retryable;
  }
}
async function fetchSource(url, fetcher, signal, json = false, timeoutMs = 15000) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response;
  try { response = await fetcher(url, { signal: requestSignal }); }
  catch (error) {
    if (signal?.aborted) throw error;
    throw new LoadError('network', `Could not fetch ${url}`, true);
  }
  if (!response.ok) throw new LoadError(response.status === 404 ? 'missing' : 'network', `${response.status}: ${url}`, response.status !== 404);
  try { return json ? await response.json() : await response.text(); }
  catch (error) {
    if (signal?.aborted) throw error;
    if (requestSignal.aborted) throw new LoadError('network', `Timed out: ${url}`, true);
    throw new LoadError('invalid', `Unreadable source: ${url}`);
  }
}

export async function structureHash(commands) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(scriptSignature(commands)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// A language or audio failure must not discard another usable language.
// The caller owns cancellation; no aborted/rejected fetch is cached.
export async function loadStory(source, { language = 'es', signal, fetcher = fetch, timeoutMs = 15000 } = {}) {
  if (source?.format !== 'avg') throw new LoadError('format', `Unsupported source format: ${source?.format}`);
  const entries = Object.entries(source.languages || {}).filter(([lang, url]) => ['es', 'en'].includes(lang) && typeof url === 'string');
  if (!entries.length) throw new LoadError('missing', 'No story sources');
  const results = await Promise.allSettled([
    ...entries.map(async ([lang, url]) => {
      const text = await fetchSource(url, fetcher, signal, false, timeoutMs);
      const inspected = inspectScript(text);
      if (inspected.issues.length) {
        const issue = inspected.issues[0];
        throw new LoadError(issue.code === 'unsupported' ? 'unsupported' : 'invalid', issue.detail);
      }
      if (source.structure && await structureHash(inspected.commands) !== source.structure) {
        throw new LoadError('alignment', `Source structure changed: ${lang}`);
      }
      return [lang, inspected.commands];
    }),
    fetchSource('./data/audio.json', fetcher, signal, true, timeoutMs),
  ]);
  if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
  const scripts = {}, problems = [];
  results.slice(0, entries.length).forEach((result, index) => {
    if (result.status === 'fulfilled') scripts[result.value[0]] = result.value[1];
    else problems.push({ language: entries[index][0], error: result.reason });
  });
  if (!Object.keys(scripts).length) {
    const failure = problems.find((p) => p.language === language) || problems[0];
    throw failure?.error || new LoadError('missing', 'No usable story sources');
  }
  const actualLanguage = scripts[language] ? language : Object.keys(scripts)[0];
  if (scripts.es && scripts.en && scriptSignature(scripts.es) !== scriptSignature(scripts.en)) {
    // Never map a saved line/choice to a structurally different translation.
    // Spanish is the canonical source for the translated collection's saves.
    delete scripts.en;
    problems.push({ language: 'en', error: new LoadError('alignment', 'English/Spanish command structure differs') });
  }
  const audioResult = results.at(-1);
  const audio = audioResult.status === 'fulfilled' && audioResult.value && typeof audioResult.value === 'object' && !Array.isArray(audioResult.value)
    ? audioResult.value : {};
  if (audioResult.status === 'rejected' || !Object.keys(audio).length) {
    problems.push({ language: 'audio', error: new LoadError('audio', 'Audio mappings are unavailable', true) });
  }
  const chosen = scripts[actualLanguage] ? actualLanguage : 'es';
  return { scripts, language: chosen, audio, problems, fallback: chosen !== language, structure: await structureHash(scripts[chosen]) };
}
