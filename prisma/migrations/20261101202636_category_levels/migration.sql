-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Category" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "level0" TEXT NOT NULL,
    "level1" TEXT NOT NULL,
    "level3" TEXT NOT NULL,
    "level5" TEXT NOT NULL,
    "weight" INTEGER NOT NULL,
    "awardName" TEXT NOT NULL,
    "awardFor" TEXT NOT NULL
);
INSERT INTO "new_Category" ("awardFor", "awardName", "id", "name", "position", "question", "level0", "level1", "level3", "level5", "weight") SELECT "awardFor", "awardName", "id", "name", "position", "question", '', '', '', '', "weight" FROM "Category";
DROP TABLE "Category";
ALTER TABLE "new_Category" RENAME TO "Category";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

UPDATE "Category" SET "level0" = 'Nobody is asked to give anything up.', "level1" = 'A small or far-off loss, or one he says won''t happen.', "level3" = 'A real loss to many: a craft, a feed, a share of the web''s traffic.', "level5" = 'Taken outright, at scale: thousands of jobs, a whole trade, everything on your screen.' WHERE "id" = 'loss';
UPDATE "Category" SET "level0" = 'Speaks to them as equals, or with some humility.', "level1" = 'Plain or polite, with at most a hint of looking down.', "level3" = 'Their worries are brushed aside, or they are told what is good for them.', "level5" = 'Tells them their work, their view or they themselves don''t count.' WHERE "id" = 'condescension';
UPDATE "Category" SET "level0" = 'Reads the room: nobody without a billion dollars would wince.', "level1" = 'Reasonable in its moment, with little to wince at.', "level3" = 'Said to the people it costs, in the wrong room or at the wrong moment, as if it were good news.', "level5" = 'Hardship sold as an opportunity, at the worst possible moment, by the man who can afford it.' WHERE "id" = 'tone-deafness';
UPDATE "Category" SET "level0" = 'No catastrophe forecast; optimism, however grand, scores nothing here.', "level1" = 'A mild or narrow worry, hedged or in passing.', "level3" = 'Upheaval for society at large, forecast as coming.', "level5" = 'The end of humanity, or of work as we know it, said out loud.' WHERE "id" = 'doom';
UPDATE "Category" SET "level0" = 'No contradiction on record; selling the thing he talks about is not one.', "level1" = 'A small or arguable clash with something on record, named in the reason.', "level3" = 'Clearly at odds with something he or his company said or did, named in the reason.', "level5" = 'The opposite of what he said, or the very thing he ruled out.' WHERE "id" = 'hypocrisy';
