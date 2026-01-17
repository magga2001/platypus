DROP INDEX "user_idx";--> statement-breakpoint
DROP INDEX "time_idx";--> statement-breakpoint
DROP INDEX "user_time_idx";--> statement-breakpoint
DROP INDEX "user_coin_idx";--> statement-breakpoint
DROP INDEX "hash_idx";--> statement-breakpoint
CREATE INDEX "user_idx" ON "user_fills" USING btree ("user");--> statement-breakpoint
CREATE INDEX "time_idx" ON "user_fills" USING btree ("time");--> statement-breakpoint
CREATE INDEX "user_time_idx" ON "user_fills" USING btree ("user","time");--> statement-breakpoint
CREATE INDEX "user_coin_idx" ON "user_fills" USING btree ("user","coin");--> statement-breakpoint
CREATE INDEX "hash_idx" ON "user_fills" USING btree ("hash");