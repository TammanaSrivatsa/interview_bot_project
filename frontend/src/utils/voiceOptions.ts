export type VoicePreference = 'female' | 'male';

export const VOICE_STORAGE_KEY = 'interviewBotVoicePreference';

const FEMALE_HINTS = [
  'female',
  'woman',
  'samantha',
  'victoria',
  'karen',
  'moira',
  'tessa',
  'veena',
  'sonia',
  'aria',
  'ava',
  'emma',
  'joanna',
  'salli',
  'kimberly',
  'jenny',
  'michelle',
  'allison',
  'amy',
  'libby',
  'susan',
  'zira',
  'hazel'
];

const MALE_HINTS = [
  'male',
  'man',
  'alex',
  'daniel',
  'fred',
  'thomas',
  'oliver',
  'arthur',
  'brian',
  'guy',
  'matthew',
  'justin',
  'joey',
  'stephen',
  'ryan',
  'davis',
  'david',
  'mark',
  'george',
  'liam'
];

const normalize = (value?: string | null) => (value || '').trim().toLowerCase();

const scoreVoice = (voice: SpeechSynthesisVoice, hints: string[]) => {
  const haystack = `${voice.name || ''} ${voice.voiceURI || ''}`.toLowerCase();
  return hints.reduce((score, hint) => score + (haystack.includes(hint) ? 1 : 0), 0);
};

const isEnglishVoice = (voice: SpeechSynthesisVoice) => normalize(voice.lang).startsWith('en');

export const getPreferredVoices = (voices: SpeechSynthesisVoice[] = []) => {
  const englishVoices = voices.filter(isEnglishVoice);
  const pool = englishVoices.length > 0 ? englishVoices : voices;

  const rankedFemale = [...pool]
    .map((voice) => ({ voice, score: scoreVoice(voice, FEMALE_HINTS) }))
    .sort((a, b) => b.score - a.score);

  const female = rankedFemale[0]?.voice || pool[0] || null;

  const rankedMale = [...pool]
    .filter((voice) => !female || voice.voiceURI !== female.voiceURI)
    .map((voice) => ({ voice, score: scoreVoice(voice, MALE_HINTS) }))
    .sort((a, b) => b.score - a.score);

  const male = rankedMale[0]?.voice || pool.find((voice) => !female || voice.voiceURI !== female.voiceURI) || female;

  return {
    female,
    male
  };
};

export const getStoredVoicePreference = () => {
  if (typeof window === 'undefined') return 'female';
  const stored = window.localStorage.getItem(VOICE_STORAGE_KEY);
  return stored === 'male' ? 'male' : 'female';
};

export const persistVoicePreference = (voiceType: VoicePreference) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(VOICE_STORAGE_KEY, voiceType === 'male' ? 'male' : 'female');
};
