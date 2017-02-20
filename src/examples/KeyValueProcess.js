import { Process } from '../';

export default Process.create(function* receive(state, message, processName, { send }) {
  const { type, key, value } = message;
  if(type === 'get') {
    send(processName, state[value]);
  }
  if(type === 'set') {
    state[key] = value;
  }
  return state;
});
