export type Message = {
  role: 'user' | 'model' | 'system';
  text: string;
  persona?: string;
};

export type Exercise = {
  id: string;
  title: string;
  description: string;
  isQuiz?: boolean;
};

export type Language = {
  code: string;
  name: string;
  flag: string;
};

export type AIModel = {
  id: string;
  name: string;
  supportsThinking?: boolean;
};

export const AI_MODELS: AIModel[] = [
  { id: 'gemini-flash-latest', name: 'Gemini Flash (Latest)' },
  { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash' },
  { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite' },
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview' },
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro Preview', supportsThinking: true },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', supportsThinking: true },
  { id: 'gemini-pro-latest', name: 'Gemini Pro (Latest)', supportsThinking: true },
];

export const LANGUAGES: Language[] = [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'ja', name: 'Japanese', flag: '🇯🇵' },
  { code: 'ko', name: 'Korean', flag: '🇰🇷' },
  { code: 'th', name: 'Thai', flag: '🇹🇭' },
  { code: 'es', name: 'Spanish', flag: '🇪🇸' },
  { code: 'vi', name: 'Vietnamese', flag: '🇻🇳' },
  { code: 'fr', name: 'French', flag: '🇫🇷' },
  { code: 'de', name: 'German', flag: '🇩🇪' },
  { code: 'zh', name: 'Chinese', flag: '🇨🇳' },
];

export const EXERCISES: Exercise[] = [
  {
    id: 'objective1',
    title: 'Objective 1: Scope the Initial POV',
    description: 'Practice discovery conversations to scope a POV for M-Pay. (Meeting Room Simulation)',
  },
  {
    id: 'objective2',
    title: 'Objective 2: Scope Creep Challenge',
    description: 'Handle a curveball scenario mid-evaluation without derailing the POV. (Meeting Room Simulation)',
  },
  {
    id: 'techfit',
    title: 'Technical Fit Qualification',
    description: 'Practice qualifying a prospect using the 7 Signs of Technical Fit. (Coaching Quiz)',
    isQuiz: true,
  },
  {
    id: 'valueselling',
    title: 'Value Selling Practice',
    description: 'Practice the value-selling sequence end-to-end. (Coaching Quiz)',
    isQuiz: true,
  },
];
