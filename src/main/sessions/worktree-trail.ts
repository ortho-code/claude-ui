/**
 * Where a session's moves between worktrees leave it, read from its transcript record by record.
 * A session can ENTER a worktree mid-life (claude's EnterWorktree tool): the transcript stays in its original project dir and only a worktree-state record says so, so the first cwd the transcript gives goes stale.
 * The LAST worktree-state wins: entered (a worktreeSession object) puts the session at worktreePath; exited (worktreeSession null) drops it back to the recorded original cwd.
 */
export class WorktreeTrail {
  /** Where in the transcript the session last entered or left a worktree, by position; -1 for never. */
  movedAt = -1;
  private stateCwd: string | null = null;
  private originalCwd = '';
  // An exit does not undo where the session did its work, so the worktree it last entered is kept through one, and a later enter clears it.
  private entered = '';
  private leftPath = '';
  // Whether the session is in a worktree by its records, so only the first null after an entry is an exit: Claude Code writes null again and again after an exit, at each resume too.
  private inWorktree = false;
  // An exit is a MOVE when claude's ExitWorktree tool made it, and a close otherwise, since Claude Code writes the same records when a session closes in its worktree.
  // The call has been seen two records after its exit, in the same turn, so it counts before the exit or after it until the next user record: a call after a later prompt, such as one a resume brings, is not the exit's, and Claude Code refuses it for a worktree from an earlier session.
  private exitCalled = false;
  private exitAwaitsCall = false;
  private movedByTool = false;

  /** A user record: an ExitWorktree call after it belongs to no exit before it. */
  userRecord(): void {
    this.exitAwaitsCall = false;
  }

  /** A worktree-state record, at `position` in the transcript. */
  state(event: Record<string, unknown>, position: number): void {
    const ws = event.worktreeSession as { worktreePath?: unknown; originalCwd?: unknown } | null;
    if (ws && typeof ws.worktreePath === 'string') {
      // Claude Code writes the state again with each turn while the session is in its worktree, and a repeat is no move.
      if (!this.inWorktree || this.stateCwd !== ws.worktreePath) this.movedAt = position;
      this.stateCwd = ws.worktreePath;
      this.entered = ws.worktreePath;
      this.leftPath = '';
      if (typeof ws.originalCwd === 'string') this.originalCwd = ws.originalCwd;
      this.inWorktree = true;
      this.exitCalled = false;
      this.exitAwaitsCall = false;
      this.movedByTool = false;
    } else {
      // Exited (worktreeSession null carries no path); fall back to the enter record's original cwd.
      this.stateCwd = this.originalCwd || null;
      this.leftPath = this.entered;
      if (this.inWorktree) {
        this.movedByTool = this.exitCalled;
        this.exitAwaitsCall = !this.exitCalled;
        this.movedAt = position;
      }
      this.inWorktree = false;
    }
  }

  /** Claude called its ExitWorktree tool: before its exit, it is waited for; after it, in the same turn, it settles the exit already read as a close. */
  exitCall(): void {
    if (this.inWorktree) this.exitCalled = true;
    else if (this.exitAwaitsCall) this.movedByTool = true;
  }

  /** Where the records put the session, over the first cwd the transcript gives; null when no record moved it. */
  get cwd(): string | null {
    return this.stateCwd;
  }

  /** The path of the worktree the session last entered, when it has left it since; '' otherwise. */
  get left(): string {
    return this.leftPath;
  }

  /** Whether it left that worktree by claude's ExitWorktree tool rather than by closing there. */
  get movedOut(): boolean {
    return this.leftPath !== '' && this.movedByTool;
  }
}
