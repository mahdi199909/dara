// The owner erasing an account's data, or the whole account, from the server (/dashboard).
//
// Why an explicit order instead of relying on cascades: several links between a person's own rows are
// ON DELETE RESTRICT (a transaction's account, a task's category …). Deleting the User row alone cascades
// into every table at once, and PostgreSQL may reach an account before the transactions that still point
// at it. Deleting leaves first, then the rows they pointed at, always works; children that do cascade
// from their parent (time entries, check-ins, installments, event completions, asset transactions) go
// with it.
//
// What this cannot reach: the copy of the data on the person's phone. Both actions end every session,
// so the phone stops syncing; if an erased (not deleted) account signs in again, that phone's copy is
// uploaded again — its own data, on its own device.
import { prisma } from "./db";
import { seedDefaultCategoriesForUser } from "./defaults";

export interface ErasureCounts {
  [table: string]: number;
}

/** Deletes every row of data the account owns, keeping the account itself, its settings and subscription. */
export async function eraseUserData(userId: string, opts: { reseedCategories?: boolean } = {}): Promise<ErasureCounts> {
  const counts: ErasureCounts = {};
  await prisma.$transaction(
    async (tx) => {
      const where = { userId };
      const steps: Array<[string, () => Promise<{ count: number }>]> = [
        // Rows that point at others first.
        ["Transaction", () => tx.transaction.deleteMany({ where })],
        ["VirtualAssetEntry", () => tx.virtualAssetEntry.deleteMany({ where })],
        ["Reminder", () => tx.reminder.deleteMany({ where })],
        ["Notification", () => tx.notification.deleteMany({ where })],
        ["Budget", () => tx.budget.deleteMany({ where })],
        ["SavingsGoal", () => tx.savingsGoal.deleteMany({ where })],
        ["CapitalSnapshot", () => tx.capitalSnapshot.deleteMany({ where })],
        ["ShownInsight", () => tx.shownInsight.deleteMany({ where })],
        ["DailyNote", () => tx.dailyNote.deleteMany({ where })],
        // Then what they pointed at (children cascade).
        ["Activity", () => tx.activity.deleteMany({ where })],
        ["Task", () => tx.task.deleteMany({ where })],
        ["Event", () => tx.event.deleteMany({ where })],
        ["InstallmentPlan", () => tx.installmentPlan.deleteMany({ where })],
        ["Habit", () => tx.habit.deleteMany({ where })],
        ["Asset", () => tx.asset.deleteMany({ where })],
        ["FinanceAccount", () => tx.financeAccount.deleteMany({ where })],
        // A project's own category points at the project, and tasks/transactions (gone now) at categories.
        ["Category", () => tx.category.deleteMany({ where })],
        ["Project", () => tx.project.deleteMany({ where })],
        ["SyncTombstone", () => tx.syncTombstone.deleteMany({ where })],
        ["AuditLog", () => tx.auditLog.deleteMany({ where })],
        ["VerificationCode", () => tx.verificationCode.deleteMany({ where })],
      ];
      for (const [table, run] of steps) counts[table] = (await run()).count;
      // Every device must sign in again (and so stops pushing its copy without the person knowing).
      await tx.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } });
    },
    { timeout: 120_000, maxWait: 10_000 }
  );
  // An account with no categories at all cannot record anything; give it the defaults a new one gets.
  if (opts.reseedCategories !== false) await seedDefaultCategoriesForUser(userId);
  return counts;
}

/** Erases the data, then the account itself (settings, subscription and all). */
export async function deleteAccount(userId: string): Promise<ErasureCounts> {
  const counts = await eraseUserData(userId, { reseedCategories: false });
  await prisma.user.delete({ where: { id: userId } });
  return counts;
}
