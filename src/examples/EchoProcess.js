import { Process } from '../';

export default Process.create(function* receive(state, message, processName, { send }) {
  send(processName, message);
  return state;
});
