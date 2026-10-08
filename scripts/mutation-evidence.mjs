// Isolated insecure fixture proves the authorization test detects removal of the server gate.
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs';import {spawnSync} from 'node:child_process';
const fixture='server.insecure-fixture.mjs',testFixture='test/.insecure-fixture.test.mjs';
try{
  const source=readFileSync('server.mjs','utf8').replace("!current||!authorized(req,current[role+'Hash'])","!current");
  if(source===readFileSync('server.mjs','utf8'))throw new Error('Mutation target missing.');
  writeFileSync(fixture,source);writeFileSync(testFixture,readFileSync('test/http.test.mjs','utf8').replace("../server.mjs","../server.insecure-fixture.mjs"));
  const result=spawnSync(process.execPath,['--test','--test-name-pattern=child and forged tokens',testFixture],{encoding:'utf8'});
  writeFileSync('docs/authorization-red.txt',result.stdout+result.stderr);process.stdout.write(result.stdout+result.stderr);
  if(result.status!==1)throw new Error('Authorization mutation was not detected with test exit 1.');
  console.log('Isolated insecure authorization fixture detected; production source was unchanged.');
}finally{for(const file of [fixture,testFixture])try{unlinkSync(file);}catch{}}
