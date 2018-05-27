'use strict';

const EventEmitter = require('events');
const irslackd     = require('../lib/irslackd.js');
const ircd         = require('../lib/ircd.js');

class MockIrcd extends ircd.Ircd  {
  listen(port, host) {
  }
}

class MockIrcSocket extends EventEmitter {
  constructor(t) {
    super();
    this.t = t;
    this.expectedLines = [];
  }
  write(actualLine) {
    const testMsg = 'Expected IRCd line: ' + actualLine;
    for (let i = 0; i < this.expectedLines.length; i++) {
      let expectedLine = this.expectedLines[i];
      if (expectedLine.trim() === actualLine.trim()) {
        this.t.ok(true, testMsg);
        return true;
      }
    }
    this.t.fail(testMsg);
    return false;
  }
  end() {
  }
  expect(expectedLine) {
    this.expectedLines.push(expectedLine);
  }
}

class MockSlackWebClient {
  constructor(t) {
    this.t = t;
    this.expectedCalls = [];
  }
  async apiCall(actualMethod, actualOptions) {
    const testMsg = 'Expected Slack API call: ' + actualMethod + '(' + JSON.stringify(actualOptions) + ')';
    for (let i = 0; i < this.expectedCalls.length; i++) {
      let [expectedMethod, expectedOptions, result] = this.expectedCalls[i];
      if (actualMethod === expectedMethod && JSON.stringify(actualOptions) === JSON.stringify(expectedOptions)) {
        this.t.ok(true, testMsg);
        this.expectedCalls.splice(i, 1);
        return new Promise((resolve, reject) => {
          resolve(result);
        });
      }
    }
    this.t.fail(testMsg);
    return new Promise((resolve, reject) => {
      resolve({ok: false});
    });
  }
  expect(expectedMethod, expectedOptions, result) {
    this.expectedCalls.push([expectedMethod, expectedOptions, result]);
  }
}

class MockSlackRtmClient extends EventEmitter {
  constructor(t) {
    super();
    this.t = t;
  }
  start() {
  }
  disconnect() {
  }
}

async function connectOneIrcClient(t) {
  // Start daemon
  const daemon = new irslackd.Irslackd({
    host: '1.2.3.4',
    port: 1234,
    tlsOpts: {
      key: 'key',
      cert: 'cert',
    },
  });
  daemon.getNewIrcd           = (tlsOpts) => { return new MockIrcd(tlsOpts);     };
  daemon.getNewSlackRtmClient = (token)   => { return new MockSlackRtmClient(t); };
  daemon.getNewSlackWebClient = (token)   => {
    const slackWeb = new MockSlackWebClient(t);
    slackWeb.expect('auth.test',  undefined,           { ok: true, user_id: 'U1234USER' });
    slackWeb.expect('users.info', {user: 'U1234USER'}, { ok: true, user: { name: 'test_slack_user' }});
    return slackWeb;
  };
  daemon.listen();

  // Connect client
  const ircSocket = new MockIrcSocket(t);
  daemon.onIrcConnect(ircSocket);
  const ircUser = daemon.socketMap.get(ircSocket);
  t.ok(ircUser, 'Expected ircUser after onIrcConnect');

  // Send connect commands
  await daemon.onIrcNick(ircUser, {args: [ 'test_irc_nick' ] });
  await daemon.onIrcPass(ircUser, {args: [ 'test_token' ] });
  await daemon.onIrcUser(ircUser, {args: [ 'test_irc_user' ] });
  t.equal(ircUser.ircNick,     'test_slack_user', 'Expected ircNick after USER');
  t.equal(ircUser.slackToken,  'test_token',      'Expected slackToken after USER');
  t.equal(ircUser.slackUserId, 'U1234USER',       'Expected slackUserId after USER');
  t.ok(ircUser.slackWeb, 'Expected slackWeb after USER');
  t.ok(ircUser.slackRtm, 'Expected slackRtm after USER');

  // Send ready event from Slack
  const slackWeb = ircUser.slackWeb;
  const slackRtm = ircUser.slackRtm;
  slackWeb.expect('users.list', {}, { ok: true, members: [
    { id: 'U1234USER', name: 'test_slack_user', deleted: false },
    { id: 'U1235FOOO', name: 'test_slack_fooo', deleted: false },
    { id: 'U1235BARR', name: 'test_slack_barr', deleted: false },
    { id: 'U1235BAZZ', name: 'test_slack_bazz', deleted: false },
    { id: 'U1235QUUX', name: 'test_slack_quux', deleted: false },
  ]});
  slackWeb.expect('conversations.list', { types: 'public_channel,private_channel,mpim' }, { ok: true, channels: [
    { id: 'C1234CHAN1', name: 'test_chan_1', is_member: true,  topic: { value: 'topic1' }},
    { id: 'C1235CHAN2', name: 'test_chan_2', is_member: false, topic: { value: 'topic2' }},
  ]});
  slackWeb.expect('users.setPresence', { presence: 'auto' }, { ok: true });
  slackWeb.expect('usergroups.list', { include_count: false, include_disabled: false, include_users: false }, { ok: true, usergroups: [
    { id: '', handle: '' },
    { id: '', handle: '' },
  ]});
  slackWeb.expect('conversations.members', { channel: 'C1234CHAN1' }, { ok: true, members: [
    'U1234USER',
    'U1235FOOO',
    'U1235BARR',
  ]});
  ircSocket.expect(':irslackd 001 test_slack_user irslackd');
  ircSocket.expect(':irslackd 376 test_slack_user :End of MOTD');
  ircSocket.expect(':test_slack_user JOIN #test_chan_1');
  ircSocket.expect(':irslackd 332 test_slack_user #test_chan_1 :topic1');
  ircSocket.expect(':irslackd 353 test_slack_user = #test_chan_1 :test_slack_user test_slack_user test_slack_fooo test_slack_barr');
  await daemon.onSlackReady(ircUser, 'ready');
  return {
    daemon: daemon,
    ircSocket: ircSocket,
    ircUser: ircUser,
    slackWeb: slackWeb,
    slackRtm: slackRtm,
  };
}

exports.MockSlackWebClient = MockSlackWebClient;
exports.MockSlackRtmClient = MockSlackRtmClient;
exports.MockIrcd = MockIrcd;
exports.MockIrcSocket = MockIrcSocket;
exports.connectOneIrcClient = connectOneIrcClient;