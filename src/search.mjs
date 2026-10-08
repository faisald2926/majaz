export const normalize=s=>s.normalize('NFKC').replace(/[\u064B-\u065F\u0670\u0640]/g,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').toLowerCase();
export function search(cards,query){const terms=normalize(query).trim().split(/\s+/).filter(Boolean);return {cards:cards.filter(c=>terms.every(t=>normalize(c.title+' '+c.text).includes(t)))};}
