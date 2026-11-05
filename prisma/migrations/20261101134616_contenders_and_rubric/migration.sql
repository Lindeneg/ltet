-- CreateTable
CREATE TABLE "Contender" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "photoAuthor" TEXT,
    "photoLicence" TEXT,
    "photoLicenceUrl" TEXT,
    "photoSource" TEXT,
    "photoChanges" TEXT
);

-- CreateTable
CREATE TABLE "Rubric" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "maxPerCategory" INTEGER NOT NULL,
    "unitOne" TEXT NOT NULL,
    "unitMany" TEXT NOT NULL,
    "titleFirst" TEXT NOT NULL,
    "titleLast" TEXT NOT NULL,
    "topStatementName" TEXT NOT NULL,
    "topStatementFor" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "weight" INTEGER NOT NULL,
    "awardName" TEXT NOT NULL,
    "awardFor" TEXT NOT NULL
);
