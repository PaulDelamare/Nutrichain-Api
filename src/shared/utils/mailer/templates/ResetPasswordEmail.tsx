import React from 'react';
import { Text, Button, Hr } from '@react-email/components';
import { Layout } from './Layout';

interface ResetPasswordEmailProps {
  name: string;
  resetLink: string;
}

export const ResetPasswordEmail: React.FC<ResetPasswordEmailProps> = ({ name, resetLink }) => {
  return (
    <Layout>
      <Text style={styles.title}>Réinitialisation de votre compte NutriChain 🔒</Text>

      <Text style={styles.paragraph}>Bonjour {name},</Text>

      <Text style={styles.paragraph}>
        Vous avez récemment fait une demande de réinitialisation de mot de passe pour votre compte
        B2B/IoT sur NutriChain. Pour choisir un nouveau mot de passe de manière totalement
        sécurisée, veuillez cliquer sur le lien ci-dessous.
      </Text>

      <Hr style={styles.separator} />

      <Text style={styles.center}>
        <Button style={styles.button} href={resetLink}>
          Réinitialiser mon mot de passe
        </Button>
      </Text>

      <Text style={styles.small}>
        Attention, ce lien n'est valide que pour une durée très courte pour des raisons de sécurité.
        Si vous n'avez pas demandé ce changement, ignorez cet e-mail.
      </Text>
    </Layout>
  );
};

// --- STYLES EXPORTABLES (Simples) ---
const styles = {
  title: {
    fontSize: '24px',
    lineHeight: '1.25',
    fontWeight: '700',
    color: '#333',
  },
  paragraph: {
    fontSize: '16px',
    lineHeight: '1.5',
    color: '#555',
  },
  separator: {
    borderColor: '#eee',
    margin: '20px 0',
  },
  button: {
    backgroundColor: '#dc2626', // Tailwind red-600
    borderRadius: '6px',
    color: '#fff',
    fontSize: '16px',
    textDecoration: 'none',
    textAlign: 'center' as const,
    display: 'inline-block',
    fontWeight: 'bold',
    padding: '12px 24px',
    border: 'none',
  },
  center: {
    textAlign: 'center' as const,
    margin: '32px 0',
  },
  small: {
    fontSize: '12px',
    color: '#8898aa',
  },
};
