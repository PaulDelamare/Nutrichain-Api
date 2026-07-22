-- CreateTable
CREATE TABLE "login_attempt" (
    "email_hash" TEXT NOT NULL,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "first_failed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "login_attempt_pkey" PRIMARY KEY ("email_hash")
);

-- CreateIndex
CREATE INDEX "login_attempt_locked_until_idx" ON "login_attempt"("locked_until");
