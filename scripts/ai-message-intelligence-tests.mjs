import assert from 'node:assert/strict';
import { voiceQueryEngine } from '../src/lib/ai/voiceQueryEngine.ts';
import { get_messages } from '../src/lib/ai/aiReadTools.ts';
import { isMessageReadingIntent, readTrackerMessages } from '../src/lib/ai/messageIntelligence.ts';

const now = new Date();
const recent = new Date(now.getTime()-60000).toISOString();
const old = new Date(now.getTime()-86400000*4).toISOString();
const ancient = new Date(now.getTime()-86400000*10).toISOString();
const profile = (id,name,role,status='active') =>
  ({id,full_name:name,email:id+'@example.test',role,status,created_at:recent});
const admin=profile('admin','Owner Admin','admin');
const manager=profile('manager','Project Manager','project_manager');
const zain=profile('zain','Zain Ahmad','employee');
const hamza=profile('hamza','Hamza Khan','employee');
const client=profile('client','Client Author','client');
const inactive=profile('inactive','Inactive Manager','project_manager','inactive');
const project=(id,title)=>({id,project_title:title,project_number:id,project_status:'active'});
const alpha=project('project1','Alpha Book');
const beta=project('project2','Beta Book');
const conversation=(id,type,project_id=null,name=null)=>({
 id,type,project_id,name,created_at:old,updated_at:recent,
});
const member=(id,conversation_id,user_id,last_read_at=ancient)=>({
 id,conversation_id,user_id,last_read_at,created_at:old,
});
const message=(id,conversation_id,sender_id,body,created_at=recent)=>({
 id,conversation_id,sender_id,body,created_at,updated_at:created_at,
});
const conversations=[
 conversation('dmPrivate','dm'),
 conversation('dmAdmin','dm'),
 conversation('internal','project_internal','project1'),
 conversation('clientProject','project_client','project1'),
 conversation('team','team_channel'),
 conversation('hiddenProject','project_internal','project2'),
];
const conversationMembers=[
 member('a','dmPrivate','zain'),member('b','dmPrivate','hamza'),
 member('c','dmAdmin','admin'),member('d','dmAdmin','manager'),
 member('e','internal','admin',old),member('f','clientProject','admin',old),
 member('g','team','admin',old),
];
const messages=[
 message('mPrivate','dmPrivate','zain','PRIVATE staff salary negotiation'),
 message('mAdmin','dmAdmin','manager','Please review the private budget'),
 message('mInternal','internal','zain','Please check the EPUB'),
 message('mClient','clientProject','client','Can you approve the proof?'),
 message('mTeam','team','manager','Please update the timeline'),
 message('mHidden','hiddenProject','hamza','Secret beta project'),
 message('mOld','internal','zain','Old message', ancient),
];
const data={
 profiles:[admin,manager,zain,hamza,client,inactive],projects:[alpha,beta],
 conversations,conversationMembers,messages,
 tasks:[],revisionRequests:[],
};
const ctx={currentProfile:admin,data,visibleProjects:[alpha],visibleTasks:[],formatMoney:()=>'',convertMoney:()=>0};

assert.equal(isMessageReadingIntent('Summarize unread client messages today'),true);
assert.equal(isMessageReadingIntent('What did Zain say?'),true);
assert.equal(isMessageReadingIntent('Find messages about Alpha Book'),true);
assert.equal(isMessageReadingIntent('Messages containing "timeline"'),true);
for(const s of ['Send Zain a message saying hi','Draft a reply to the client','Mark all messages as read','What are my tasks?']){
 assert.equal(isMessageReadingIntent(s),false,s);
}
const all = readTrackerMessages('Show recent messages',ctx);
assert.equal(all.success,true);
assert.equal(all.count,5);
assert.match(all.displayText,/private budget/);
assert.match(all.displayText,/EPUB/);
assert.doesNotMatch(all.displayText,/staff salary negotiation/,'Admin must not see unrelated private DM');
assert.doesNotMatch(all.displayText,/Secret beta/,'Non-visible project data cannot leak');

const unread = readTrackerMessages('Summarize unread messages',ctx);
assert.equal(unread.count,4,"Unread uses member.last_read_at and excludes the user's own sent messages");
assert.doesNotMatch(unread.displayText,/Old message/);
const clientMessages = readTrackerMessages('Show client messages',ctx);
assert.equal(clientMessages.count,1);
assert.match(clientMessages.displayText,/approve the proof/);
const sender = readTrackerMessages('What did Zain say?',ctx);
assert.equal(sender.count,2);
assert.match(sender.displayText,/EPUB/);
assert.doesNotMatch(sender.displayText,/PRIVATE staff salary/);
const projectMessages = readTrackerMessages('Show messages about Alpha Book',ctx);
assert.equal(projectMessages.count,3,'Project scope includes internal and client project conversations');
const keyword = readTrackerMessages('Find messages containing "timeline"',ctx);
assert.equal(keyword.count,1);
const questions = readTrackerMessages('Show messages with questions',ctx);
assert.ok(questions.count > 0);

assert.equal(readTrackerMessages('Show messages',{...ctx,currentProfile:client}).error,'permission_denied');
assert.equal(readTrackerMessages('Show messages',{...ctx,currentProfile:inactive}).error,'permission_denied');
const firstNameDuplicate=profile('zain2','Zain Raza','employee');
const ambiguous=readTrackerMessages('Show messages from Zain',{...ctx,data:{...data,profiles:[...data.profiles,firstNameDuplicate]}});
assert.equal(ambiguous.error,'ambiguous_sender');

const legacy=await get_messages('Zain',undefined,false,ctx);
assert.equal(legacy.count,sender.count,'Legacy reader must have same private-DM filter');

voiceQueryEngine.clearMemory();
const voice = await voiceQueryEngine.processQuery('Summarize unread client messages',ctx);
assert.equal(voice.toolName,'get_messages','Full AI router must reach message reader');
assert.equal(voice.count,1);
assert.equal(voice.pendingAction,undefined);
voiceQueryEngine.clearMemory();
const spoken = await voiceQueryEngine.processQuery('What did Zain say?',ctx);
assert.equal(spoken.toolName,'search_messages');
assert.equal(spoken.count,2);
voiceQueryEngine.clearMemory();
const taskQuestion=await voiceQueryEngine.processQuery('What are my tasks?',ctx);
assert.equal(taskQuestion.toolName,'get_tasks_summary','Unrelated task queries unaffected');
voiceQueryEngine.clearMemory();
console.log('AI message intelligence V1: read-only search, DM RLS defense, sender/project/unread, role gate and full routing PASS');
