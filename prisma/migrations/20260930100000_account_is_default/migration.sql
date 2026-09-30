-- The account a new expense or income is booked to when the person names none (one per person at most;
-- kept that way by the accounts routes, which clear the flag on the others when it is set).
ALTER TABLE "FinanceAccount" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;
