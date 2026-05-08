import React from 'react';
import { Text, Button, Hr } from '@react-email/components';
import { Layout } from './Layout';

interface InvitationEmailProps {
  email: string;
  role: string | null;
  invitationLink: string;
  inviterName?: string | null;
}

export const InvitationEmail: React.FC<InvitationEmailProps> = ({
  email,
  role,
  invitationLink,
  inviterName,
}) => {
  return (
    <Layout>
      <Text style={styles.title}>Invitation Systèmes NutriChain 👋</Text>

      <Text style={styles.paragraph}>Bonjour ({email}),</Text>

      <Text style={styles.paragraph}>
        {inviterName ? `**${inviterName}**` : 'Un administrateur de votre entreprise'} vous a convié
        sur la base de données <strong>NutriChain</strong>. Vous aurez accès à la traçabilité des
        lots et capteurs IoT avec les autorisations limitées par votre rôle de{' '}
        <strong>{role || 'Membre'}</strong>.
      </Text>

      <Hr style={styles.separator} />

      <Text style={styles.center}>
        <Button style={styles.button} href={invitationLink}>
          Accepter l'invitation et créer mon compte
        </Button>
      </Text>

      <Text style={styles.small}>
        Si vous n'êtes pas au courant de cette demande ou qu'elle ne vous est pas destinée, ignorez
        ce message.
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
    backgroundColor: '#22c55e', // Tailwind green-500
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
