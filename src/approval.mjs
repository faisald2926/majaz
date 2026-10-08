import {createHash} from 'node:crypto';
export const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function fingerprint(state,doc,card){
  const context={sourceTitle:doc.sourceTitle,mode:doc.mode,independentDeclared:doc.independentDeclared};
  if(doc.mode==='correlated') context.cards=doc.cards.map(c=>({id:c.id,title:c.title,text:c.text}));
  return digest({title:card.title,text:card.text,context,childAge:state.childAge,policyVersion:state.policyVersion});
}
export const approved=(state,doc,card)=>card.approval===fingerprint(state,doc,card);
