export const message = (error: unknown) => {
  const code = (error as { code?: string })?.code ?? '';
  if (code.includes('permission-denied'))
    return 'Access was denied. Ask the owner to check your account permissions and active status.';
  if (code.includes('auth/'))
    return 'Sign-in failed. Check your username and password, or contact the owner.';
  return error instanceof Error
    ? error.message
    : 'Could not complete this action. Check your connection and try again.';
};
