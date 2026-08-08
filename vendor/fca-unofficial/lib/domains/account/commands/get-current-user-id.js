export function createGetCurrentUserIdCommand(deps) {
  const {
    ctx
  } = deps;
  return function getCurrentUserID() {
    return ctx.userID;
  };
}
export default {
  createGetCurrentUserIdCommand
};