import cron from "node-cron";
import { bdd } from "../../../shared/configs/prismaClient.config";

/**
 * Nettoie les invitations qui sont stockées dans la base de données
 * mais dont la date d'expiration a été dépassée (sans qu'elles n'aient été acceptées).
 */
export const startCleanupJob = () => {
    // S'exécute tous les jours à Minuit ("0 0 * * *")
    cron.schedule("0 0 * * *", async () => {
        try {
            console.log("[CronTask] Lancement du nettoyage des invitations expirées...");
            const result = await bdd.invitation.deleteMany({
                where: {
                    status: "pending",
                    expiresAt: { lt: new Date() }
                }
            });
            if (result.count > 0) {
                console.log(`[CronTask] Nettoyage terminé : ${result.count} invitations supprimées.`);
            } else {
                console.log("[CronTask] Nettoyage terminé : Aucune invitation à supprimer.");
            }
        } catch (error) {
            console.error("[CronTask] Erreur lors du nettoyage :", error);
        }
    });

    console.log("⏰ Job de nettoyage des Invitations programmé (Minuit chaque jour).");
};
