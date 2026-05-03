import { config } from "dotenv";
// Charge les variables d'environnement depuis le fichier .env EN PREMIER
config();

async function testerEnvoiEmail() {
    const { sendEmail } = await import("../src/shared/utils/mailer/mailer");

    console.log("Envoi d'un e-mail de test via Ethereal en cours...");
    
    try {
        await sendEmail({
            to: "futur-utilisateur@nutrichain.com",
            subject: "Invitation à rejoindre NutriChain",
            html: `
                <div style="font-family: Arial, sans-serif; text-align: center; color: #333;">
                    <h2>Bienvenue sur NutriChain 🍏</h2>
                    <p>Vous avez été invité(e) à créer votre compte administrateur.</p>
                    <p>Veuillez cliquer sur le lien ci-dessous pour configurer votre mot de passe :</p>
                    <a href="http://localhost:3000/register?token=test-12345" 
                       style="display: inline-block; padding: 10px 20px; color: white; background-color: #28a745; text-decoration: none; border-radius: 5px;">
                       Créer mon compte
                    </a>
                    <p style="margin-top: 20px; font-size: 12px; color: #888;">Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.</p>
                </div>
            `
        });
        console.log("✅ Test terminé ! Vérifiez le lien de prévisualisation au-dessus.");
    } catch (error) {
        console.error("❌ Erreur lors du test :", error);
    }
}

testerEnvoiEmail();
