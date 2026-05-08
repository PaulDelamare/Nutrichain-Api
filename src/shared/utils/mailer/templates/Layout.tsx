import React from 'react';
import { Html, Head, Body, Container, Section, Text, Img } from '@react-email/components';

interface LayoutProps {
  children: React.ReactNode;
  previewText?: string;
}

/**
 * Super Template global : contient le style de base, le header commun (logo NutriChain)
 * et le footer commun (droits, adresses...).
 */
export const Layout: React.FC<LayoutProps> = ({ children }) => {
  return (
    <Html>
      <Head />
      <Body style={{ backgroundColor: '#f6f9fc', fontFamily: 'Arial, sans-serif' }}>
        <Container style={{ margin: '0 auto', padding: '20px 0 48px', width: '580px' }}>
          {/* HEADER GLOBAL */}
          <Section
            style={{
              padding: '20px',
              backgroundColor: '#ffffff',
              borderTopLeftRadius: '8px',
              borderTopRightRadius: '8px',
              borderBottom: '2px solid #22c55e',
            }}
          >
            <Text
              style={{
                fontSize: '24px',
                fontWeight: 'bold',
                color: '#166534',
                margin: 0,
                textAlign: 'center',
              }}
            >
              🌿 NutriChain IoT
            </Text>
          </Section>

          {/* BODY / CONTENU SPECIFIQUE INJECTE ICI */}
          <Section
            style={{
              backgroundColor: '#ffffff',
              padding: '40px',
              borderBottomLeftRadius: '8px',
              borderBottomRightRadius: '8px',
            }}
          >
            {children}
          </Section>

          {/* FOOTER GLOBAL */}
          <Section style={{ padding: '20px 0', textAlign: 'center' }}>
            <Text style={{ color: '#8898aa', fontSize: '12px' }}>
              © 2026 NutriChain - Application de Traçabilité
              <br />
              Ce message vous a été envoyé par la plateforme automatisée sécurisée de NutriChain.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};
