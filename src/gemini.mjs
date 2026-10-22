import {fail} from './corpus.mjs';

// This child-facing prototype must not activate Gemini by adding an environment key.
export const AI_DISABLED_REASON='Gemini معطّل في هذا النموذج الموجّه للأطفال؛ شروط الخدمة تمنع إدماجه في تطبيق موجّه لمن هم دون 18 عامًا أو يُحتمل وصولهم إليه. استخدم التحرير اليدوي.';
export async function draft(){fail(503,AI_DISABLED_REASON);}
