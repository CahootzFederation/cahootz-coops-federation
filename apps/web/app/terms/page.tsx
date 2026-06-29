import type { Metadata } from "next";

import { SiteShell } from "@/components/blog/site-shell";

type TermsBlock =
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] };

interface TermsSection {
  title: string;
  blocks: TermsBlock[];
}

export const metadata: Metadata = {
  title: "Terms & Conditions | Cahootz",
  description:
    "Terms and conditions for the Cahootz Coops app for mobile devices, web browsers, and related services.",
  alternates: {
    canonical: "https://cahootz.coop/terms",
  },
};

const sections: TermsSection[] = [
  {
    title: "License to use the Application",
    blocks: [
      {
        type: "paragraph",
        text: "Subject to your compliance with these Terms, the Service Provider grants you a limited, non-exclusive, non-transferable, revocable license to install and use the Application on a mobile device or computer for personal or internal business purposes. You may not reproduce, distribute, modify, create derivative works from, reverse engineer, decompile, or disassemble the Application, except as and only to the extent that such activity is expressly permitted by applicable law.",
      },
    ],
  },
  {
    title: "Intellectual Property",
    blocks: [
      {
        type: "paragraph",
        text: 'The Service Provider retains all intellectual property rights in the Application, including its code, design, trademarks, service marks, trade names, logos, and branding (the "IP"). Nothing in these Terms grants you any license or right to use the Service Provider\'s trademarks, logos, or branding for any purpose. You agree not to remove, alter, or obscure any copyright, trademark, or other proprietary notices displayed in or on the Application.',
      },
    ],
  },
  {
    title: "Termination",
    blocks: [
      {
        type: "paragraph",
        text: "The Service Provider may suspend your access to the Application or services if you materially breach these Terms. The Service Provider will provide you with written notice of the breach and, where the breach is capable of cure, you will have 14 days from receipt of notice to remedy the breach. If you fail to cure the breach within that period, the Service Provider may terminate your access.",
      },
      {
        type: "paragraph",
        text: "The Service Provider may suspend or terminate your access immediately without notice if you violate applicable law, infringe intellectual property rights, or engage in activity that could cause harm to other users or the Service Provider.",
      },
      {
        type: "paragraph",
        text: "Upon termination, your right to use the Application will end and you must delete all copies from your devices.",
      },
      {
        type: "paragraph",
        text: "By accessing and using this Application, you represent that you are legally permitted to use it in your jurisdiction. You must be at least 16 years of age (the age of digital consent in your jurisdiction) to use the Application. If you are below 16, a parent or legal guardian must review and accept these Terms on your behalf.",
      },
      {
        type: "paragraph",
        text: "Unauthorized copying, modification of the Application, any part of the Application, or the Service Provider's trademarks is strictly prohibited. Any attempts to extract the source code of the Application, translate the Application into other languages, or create derivative versions are not permitted. All trademarks, copyrights, database rights, and other intellectual property rights related to the Application remain the property of the Service Provider.",
      },
    ],
  },
  {
    title: "User-Generated Content and Acceptable Use",
    blocks: [
      {
        type: "paragraph",
        text: "If this Application allows users to post, share, or upload content, you agree not to post content that:",
      },
      {
        type: "list",
        items: [
          "Is illegal or violates third-party intellectual property rights (copyright, trademark, patents)",
          "Is abusive, threatening, harassing, defamatory, or hate speech",
          "Contains discrimination or incitement to violence or illegal activity",
          "Is spam, phishing, or contains malware",
          "Violates the privacy or personal data rights of others",
          "Is misleading, false, or deceptive",
          "Contains explicit violence or sexual content (unless age-gated appropriately)",
        ],
      },
      {
        type: "paragraph",
        text: "The Service Provider reserves the right to:",
      },
      {
        type: "list",
        items: [
          "Remove or disable access to content that violates these guidelines",
          "Suspend or terminate accounts of users who repeatedly violate these guidelines",
          "Cooperate with law enforcement if illegal content is reported",
          "Moderate, filter, or hide content that violates these Terms, applicable law, or the guidelines set out above",
        ],
      },
      {
        type: "paragraph",
        text: "Content submitted through the Application may be visible to other users or to the public, depending on how the Application functions.",
      },
      {
        type: "paragraph",
        text: "If you believe content violates these Terms, infringes your rights, or is unlawful, you may report it to the Service Provider at team@cahootzcoops.com. The report should include enough information for the Service Provider to identify the content, evaluate the complaint, and contact you if follow-up is required.",
      },
      {
        type: "paragraph",
        text: "Where the Application provides such features, you may also report content, block other users, or mute notifications directly through the Application's interface. The Service Provider will review in-app reports with the same standards described in these Terms.",
      },
      {
        type: "paragraph",
        text: "The Service Provider may review reported content, request additional information where necessary, remove or restrict access to content, and take action against the responsible account where appropriate. Users affected by moderation decisions may contact the Service Provider at team@cahootzcoops.com to request further review. The Service Provider will respond to appeals within a reasonable period and provide the reasons for any upheld moderation decision, subject to applicable law.",
      },
      {
        type: "paragraph",
        text: "By submitting User-Generated Content you grant the Service Provider a non-exclusive, worldwide, royalty-free license to use, reproduce, distribute, prepare derivative works of, display and perform the content in connection with the Application and the Service Provider's business. This license does not grant the Service Provider the right to sell or sublicense your content to third parties independently of the Application. You represent and warrant that you own or control all rights in the content you post and that use of the content does not violate these Terms or applicable law.",
      },
      {
        type: "paragraph",
        text: "Your content may include personal data. Processing of personal data related to User-Generated Content is governed by the Privacy Policy. Do not post personal data of others without their consent.",
      },
      {
        type: "paragraph",
        text: "The Service Provider is dedicated to ensuring that the Application is as beneficial and efficient as possible. As such, they reserve the right to modify the Application or charge for their services at any time and for any reason. The Service Provider assures you that any charges for the Application or its services will be clearly communicated to you.",
      },
      {
        type: "paragraph",
        text: "The Application stores and processes personal data that you have provided to the Service Provider in order to provide the Service. It is your responsibility to maintain the security of your phone and access to the Application. The Service Provider strongly advises against jailbreaking or rooting your phone, which involves removing software restrictions and limitations imposed by the official operating system of your device. Such actions could expose your phone to malware, viruses, malicious programs, compromise your phone's security features, and may result in the Application not functioning correctly or at all.",
      },
      {
        type: "paragraph",
        text: "Please be aware that the Service Provider does not assume responsibility for certain aspects. Some functions of the Application require an active internet connection, which can be Wi-Fi or provided by your mobile network provider. The Service Provider cannot be held responsible if the Application does not function at full capacity due to lack of access to Wi-Fi or if you have exhausted your data allowance.",
      },
      {
        type: "paragraph",
        text: "If you are using the application outside of a Wi-Fi area, please be aware that your mobile network provider's agreement terms still apply. Consequently, you may incur charges from your mobile provider for data usage during the connection to the application, or other third-party charges. By using the application, you accept responsibility for any such charges, including roaming data charges if you use the application outside of your home territory (i.e., region or country) without disabling data roaming. If you are not the bill payer for the device on which you are using the application, they assume that you have obtained permission from the bill payer.",
      },
      {
        type: "paragraph",
        text: "Similarly, the Service Provider cannot always assume responsibility for your usage of the application. For instance, it is your responsibility to ensure that your device remains charged. If your device runs out of battery and you are unable to access the Service, the Service Provider cannot be held responsible.",
      },
      {
        type: "paragraph",
        text: "Nothing in these Terms shall limit any rights you have under applicable consumer protection laws that cannot be lawfully excluded.",
      },
    ],
  },
  {
    title: "Limitation of Liability",
    blocks: [
      {
        type: "paragraph",
        text: "To the fullest extent permitted by law, the Service Provider shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including but not limited to lost profits, data loss, or business interruption, even if advised of the possibility of such damages.",
      },
      {
        type: "paragraph",
        text: "However, the Service Provider retains full liability for:",
      },
      {
        type: "list",
        items: [
          "Death or personal injury caused by negligence",
          "Fraud or fraudulent misrepresentation",
          "Any other liability that cannot be excluded or limited under applicable law",
        ],
      },
      {
        type: "paragraph",
        text: "To the fullest extent permitted by law, the total liability of the Service Provider for any claim shall not exceed the amount paid by you to the Service Provider for the Application in the 12 months preceding the claim, or the minimum amount that must be paid under applicable law, whichever is greater. If the Application is provided free of charge, this means the Service Provider's liability is limited to the minimum amount permitted by applicable law.",
      },
      {
        type: "paragraph",
        text: "The Service Provider accepts no liability for any loss, direct or indirect, that you experience as a result of relying entirely on third-party information provided through this Application, or for inaccuracies in content provided by third parties.",
      },
    ],
  },
  {
    title: "Indemnification",
    blocks: [
      {
        type: "paragraph",
        text: "To the fullest extent permitted by law, you agree to indemnify and hold harmless the Service Provider, its affiliates, officers, directors, employees and agents from and against any claims, liabilities, damages, losses and expenses, including reasonable legal fees, arising out of or directly related to your breach of these Terms or your intentional misuse of the Application, including User-Generated Content you submit in violation of these Terms.",
      },
      {
        type: "paragraph",
        text: "This indemnification does not apply to claims arising from the Service Provider's own negligence, breach of these Terms, or violation of applicable law. In jurisdictions where consumer indemnification is restricted by law, this clause shall be limited to the maximum extent permitted.",
      },
      {
        type: "paragraph",
        text: "The Service Provider may wish to update the application at some point. The application is currently available as per the requirements for the operating system (and for any additional systems they decide to extend the availability of the application to) may change, and you will need to download the updates if you want to continue using the application. The Service Provider does not guarantee that it will always update the application so that it is relevant to you and/or compatible with the particular operating system version installed on your device. You should accept updates when offered; if you choose not to, the Service Provider may cease to support earlier versions and the Application may not function properly. The Service Provider may also wish to cease providing the application and may terminate its use at any time without providing termination notice to you. Unless they inform you otherwise, upon any termination, (a) the rights and licenses granted to you in these terms will end; (b) you must cease using the application, and (if necessary) delete it from your device.",
      },
    ],
  },
  {
    title: "Governing Law and Jurisdiction",
    blocks: [
      {
        type: "paragraph",
        text: "These Terms and Conditions are governed by the laws of the jurisdiction in which the Service Provider is established, excluding conflict of law rules, except to the extent mandatory consumer protection laws provide otherwise.",
      },
      {
        type: "paragraph",
        text: "Any dispute arising out of or relating to these Terms will be brought before the courts that have jurisdiction under applicable law. Nothing in this clause limits any rights you may have to bring a claim in a court that is competent under mandatory law.",
      },
    ],
  },
  {
    title: "DSA Compliance (Digital Services Act)",
    blocks: [
      {
        type: "paragraph",
        text: 'If the Application is an intermediary service as defined under the Digital Services Act (Regulation (EU) 2022/2065, "DSA"), the following provisions apply in addition to the terms above.',
      },
      {
        type: "paragraph",
        text: "Point of Contact: The Service Provider maintains a single point of contact for direct communication with EU authorities and recipients of the service, reachable at team@cahootzcoops.com. Where the Service Provider is established outside the European Union, a legal representative in the EU has been designated in accordance with Article 13 of the DSA.",
      },
      {
        type: "paragraph",
        text: "Content Moderation and Statement of Reasons: When the Service Provider restricts access to content, suspends or terminates an account, or otherwise limits the availability of the Application's features, a clear and specific statement of reasons will be provided to the affected user. The statement will include the nature of the restriction, the legal or contractual basis for the decision, and information on available redress mechanisms, in accordance with Article 17 of the DSA.",
      },
      {
        type: "paragraph",
        text: "Notice and Action: Users and third parties may submit notices of allegedly illegal content through the contact details provided in these Terms. The Service Provider will process notices promptly, diligently, and without automated decision-making where the circumstances require human review. Notices will be acknowledged electronically and a decision communicated without undue delay, in accordance with Article 16 of the DSA.",
      },
      {
        type: "paragraph",
        text: "Out-of-Court Dispute Settlement: Disputes regarding content moderation decisions, including decisions to restrict content or suspend accounts, may be submitted to an out-of-court dispute settlement body certified in accordance with Article 21 of the DSA. The Service Provider will engage with such bodies in good faith. Use of out-of-court dispute settlement does not affect your right to seek judicial remedy under applicable law.",
      },
      {
        type: "paragraph",
        text: "Transparency Reporting: The Service Provider publishes periodic transparency reports covering content moderation activities, including the volume of notices received, actions taken, and automated means used, in accordance with Article 24 of the DSA. Reports are made available upon request at team@cahootzcoops.com.",
      },
      {
        type: "paragraph",
        text: "These DSA provisions apply to the extent that the Application qualifies as an intermediary service under the DSA and does not replace or limit any rights or obligations under applicable consumer protection or data protection law.",
      },
    ],
  },
  {
    title: "Severability",
    blocks: [
      {
        type: "paragraph",
        text: "If any provision of these Terms and Conditions is held to be invalid, illegal, or unenforceable by a court of competent jurisdiction, such provision shall be modified to the minimum extent necessary to make it valid and enforceable, and the remaining provisions of these Terms shall remain in full force and effect.",
      },
    ],
  },
  {
    title: "Entire Agreement",
    blocks: [
      {
        type: "paragraph",
        text: "These Terms and Conditions, together with the Privacy Policy, constitute the entire agreement between you and the Service Provider concerning your use of the Application, superseding any prior agreements or understandings.",
      },
    ],
  },
  {
    title: "Changes to These Terms and Conditions",
    blocks: [
      {
        type: "paragraph",
        text: "The Service Provider may periodically update their Terms and Conditions. Therefore, you are advised to review this page regularly for any changes. The Service Provider will notify you of any changes by posting the new Terms and Conditions on this page.",
      },
      {
        type: "paragraph",
        text: "Previous versions of these Terms and Conditions will be maintained and made available upon request by contacting the Service Provider at team@cahootzcoops.com.",
      },
      {
        type: "paragraph",
        text: "These terms and conditions are effective as of 2026-06-28.",
      },
    ],
  },
  {
    title: "Contact Us",
    blocks: [
      {
        type: "paragraph",
        text: "If you have any questions or suggestions about the Terms and Conditions, please do not hesitate to contact the Service Provider at team@cahootzcoops.com.",
      },
    ],
  },
];

export default function TermsPage() {
  return (
    <SiteShell>
      <main>
        <section className="border-b border-white/10 px-5 py-16 sm:px-6 md:py-24">
          <div className="mx-auto max-w-4xl">
            <p className="text-sm font-bold uppercase tracking-widest text-[#facc15]">
              Legal
            </p>
            <h1 className="mt-4 text-4xl font-black tracking-tight md:text-6xl">
              Terms &amp; Conditions
            </h1>
            <div className="mt-5 space-y-4 text-lg leading-8 text-slate-400">
              <p>
                These terms and conditions apply to the Cahootz Coops app for
                mobile devices and web browsers, together with any related
                services operated by Cahootz Coop (collectively, the
                &quot;Application&quot;). Cahootz Coop is hereby referred to as
                the &quot;Service Provider&quot;.
              </p>
              <p>
                By downloading or using the Application, you agree to these
                Terms and Conditions. You should read them carefully before using
                the Application.
              </p>
            </div>
          </div>
        </section>

        <section className="bg-[#161616] px-5 py-14 sm:px-6 md:py-20">
          <div className="mx-auto max-w-4xl space-y-10">
            {sections.map((section) => (
              <section
                key={section.title}
                className="border-b border-white/10 pb-10 last:border-b-0 last:pb-0"
              >
                <h2 className="text-2xl font-black tracking-tight text-white">
                  {section.title}
                </h2>
                <div className="mt-4 space-y-4 text-base leading-8 text-slate-300">
                  {section.blocks.map((block, index) =>
                    block.type === "paragraph" ? (
                      <p key={`${section.title}-${index}`}>{block.text}</p>
                    ) : (
                      <ul
                        key={`${section.title}-${index}`}
                        className="list-disc space-y-2 pl-6"
                      >
                        {block.items.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    ),
                  )}
                </div>
              </section>
            ))}

            <div className="border-t border-white/10 pt-8 text-sm leading-7 text-slate-500">
              This Terms &amp; Conditions page was generated by{" "}
              <a
                href="https://app-privacy-policy-generator.nisrulz.com/"
                className="font-semibold text-slate-300 transition hover:text-white"
                rel="noreferrer"
                target="_blank"
              >
                App Privacy Policy Generator
              </a>
              .
            </div>
          </div>
        </section>
      </main>
    </SiteShell>
  );
}
