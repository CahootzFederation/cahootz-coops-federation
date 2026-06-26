"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function EconomicFlowDiagram() {
  return (
    <div className="mx-auto w-full max-w-6xl p-6">
      <Card className="border-slate-600 bg-slate-800">
        <CardHeader className="text-center">
          <CardTitle className="mb-2 text-2xl text-white">
            How Money Circulates in the Soulaan Ecosystem
          </CardTitle>
          <p className="text-slate-300">
            Every transaction builds community wealth while rewarding
            participation
          </p>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <svg
              viewBox="0 0 1000 700"
              className="h-auto w-full"
              xmlns="http://www.w3.org/2000/svg"
            >
              {/* Background */}
              <rect width="1000" height="700" fill="#1e293b" rx="8" />

              {/* Central DAO/Wealth Fund */}
              <g>
                <circle
                  cx="500"
                  cy="350"
                  r="80"
                  fill="#3b82f6"
                  stroke="#60a5fa"
                  strokeWidth="3"
                />
                <text
                  x="500"
                  y="340"
                  textAnchor="middle"
                  fill="white"
                  fontSize="14"
                  fontWeight="bold"
                >
                  Cahootz Co-op
                </text>
                <text
                  x="500"
                  y="355"
                  textAnchor="middle"
                  fill="white"
                  fontSize="12"
                >
                  (DAO/Wealth Fund)
                </text>
                <text
                  x="500"
                  y="370"
                  textAnchor="middle"
                  fill="#fbbf24"
                  fontSize="10"
                >
                  Community Treasury
                </text>
              </g>

              {/* Participants */}

              {/* Renters */}
              <g>
                <rect
                  x="80"
                  y="120"
                  width="120"
                  height="60"
                  rx="8"
                  fill="#059669"
                  stroke="#10b981"
                  strokeWidth="2"
                />
                <text
                  x="140"
                  y="145"
                  textAnchor="middle"
                  fill="white"
                  fontSize="12"
                  fontWeight="bold"
                >
                  Renters
                </text>
                <text
                  x="140"
                  y="160"
                  textAnchor="middle"
                  fill="white"
                  fontSize="10"
                >
                  Pay rent in UC
                </text>
                <text
                  x="140"
                  y="172"
                  textAnchor="middle"
                  fill="#fbbf24"
                  fontSize="9"
                >
                  Earn 10 SC/month
                </text>
              </g>

              {/* Landlords */}
              <g>
                <rect
                  x="800"
                  y="120"
                  width="120"
                  height="60"
                  rx="8"
                  fill="#7c3aed"
                  stroke="#8b5cf6"
                  strokeWidth="2"
                />
                <text
                  x="860"
                  y="145"
                  textAnchor="middle"
                  fill="white"
                  fontSize="12"
                  fontWeight="bold"
                >
                  Landlords
                </text>
                <text
                  x="860"
                  y="160"
                  textAnchor="middle"
                  fill="white"
                  fontSize="10"
                >
                  Receive UC rent
                </text>
                <text
                  x="860"
                  y="172"
                  textAnchor="middle"
                  fill="#fbbf24"
                  fontSize="9"
                >
                  Earn 5 SC/month
                </text>
              </g>

              {/* Shoppers */}
              <g>
                <rect
                  x="80"
                  y="520"
                  width="120"
                  height="60"
                  rx="8"
                  fill="#059669"
                  stroke="#10b981"
                  strokeWidth="2"
                />
                <text
                  x="140"
                  y="545"
                  textAnchor="middle"
                  fill="white"
                  fontSize="12"
                  fontWeight="bold"
                >
                  Shoppers
                </text>
                <text
                  x="140"
                  y="560"
                  textAnchor="middle"
                  fill="white"
                  fontSize="10"
                >
                  Spend UC
                </text>
                <text
                  x="140"
                  y="572"
                  textAnchor="middle"
                  fill="#fbbf24"
                  fontSize="9"
                >
                  Earn 6 SC/100 UC
                </text>
              </g>

              {/* Business Owners */}
              <g>
                <rect
                  x="800"
                  y="520"
                  width="120"
                  height="60"
                  rx="8"
                  fill="#7c3aed"
                  stroke="#8b5cf6"
                  strokeWidth="2"
                />
                <text
                  x="860"
                  y="545"
                  textAnchor="middle"
                  fill="white"
                  fontSize="12"
                  fontWeight="bold"
                >
                  Business Owners
                </text>
                <text
                  x="860"
                  y="560"
                  textAnchor="middle"
                  fill="white"
                  fontSize="10"
                >
                  Accept UC
                </text>
                <text
                  x="860"
                  y="572"
                  textAnchor="middle"
                  fill="#fbbf24"
                  fontSize="9"
                >
                  Earn 2 SC/transaction
                </text>
              </g>

              {/* Workers */}
              <g>
                <rect
                  x="440"
                  y="80"
                  width="120"
                  height="60"
                  rx="8"
                  fill="#059669"
                  stroke="#10b981"
                  strokeWidth="2"
                />
                <text
                  x="500"
                  y="105"
                  textAnchor="middle"
                  fill="white"
                  fontSize="12"
                  fontWeight="bold"
                >
                  Workers
                </text>
                <text
                  x="500"
                  y="120"
                  textAnchor="middle"
                  fill="white"
                  fontSize="10"
                >
                  Earn wages in UC
                </text>
                <text
                  x="500"
                  y="132"
                  textAnchor="middle"
                  fill="#fbbf24"
                  fontSize="9"
                >
                  Earn 15 SC/month
                </text>
              </g>

              {/* Community Assets */}
              <g>
                <rect
                  x="440"
                  y="560"
                  width="120"
                  height="60"
                  rx="8"
                  fill="#dc2626"
                  stroke="#ef4444"
                  strokeWidth="2"
                />
                <text
                  x="500"
                  y="585"
                  textAnchor="middle"
                  fill="white"
                  fontSize="12"
                  fontWeight="bold"
                >
                  Community Assets
                </text>
                <text
                  x="500"
                  y="600"
                  textAnchor="middle"
                  fill="white"
                  fontSize="10"
                >
                  Housing, Businesses
                </text>
                <text
                  x="500"
                  y="612"
                  textAnchor="middle"
                  fill="#fbbf24"
                  fontSize="9"
                >
                  Generate Revenue
                </text>
              </g>

              {/* Flow Arrows and Labels */}

              {/* Rent Flow */}
              <defs>
                <marker
                  id="arrowhead"
                  markerWidth="10"
                  markerHeight="7"
                  refX="0"
                  refY="3.5"
                  orient="auto"
                >
                  <polygon points="0 0, 10 3.5, 0 7" fill="#10b981" />
                </marker>
                <marker
                  id="arrowhead-blue"
                  markerWidth="10"
                  markerHeight="7"
                  refX="0"
                  refY="3.5"
                  orient="auto"
                >
                  <polygon points="0 0, 10 3.5, 0 7" fill="#3b82f6" />
                </marker>
                <marker
                  id="arrowhead-yellow"
                  markerWidth="10"
                  markerHeight="7"
                  refX="0"
                  refY="3.5"
                  orient="auto"
                >
                  <polygon points="0 0, 10 3.5, 0 7" fill="#fbbf24" />
                </marker>
                <marker
                  id="arrowhead-red"
                  markerWidth="10"
                  markerHeight="7"
                  refX="0"
                  refY="3.5"
                  orient="auto"
                >
                  <polygon points="0 0, 10 3.5, 0 7" fill="#dc2626" />
                </marker>
              </defs>

              {/* Rent payment flow */}
              <path
                d="M 200 150 Q 400 100 800 150"
                stroke="#10b981"
                strokeWidth="3"
                fill="none"
                markerEnd="url(#arrowhead)"
              />
              <text
                x="500"
                y="120"
                textAnchor="middle"
                fill="#10b981"
                fontSize="11"
                fontWeight="bold"
              >
                1,200 UC/month rent
              </text>

              {/* Rent fee to DAO */}
              <path
                d="M 700 180 Q 600 250 580 320"
                stroke="#3b82f6"
                strokeWidth="2"
                fill="none"
                markerEnd="url(#arrowhead-blue)"
              />
              <text
                x="640"
                y="250"
                textAnchor="middle"
                fill="#3b82f6"
                fontSize="10"
              >
                3% fee (36 UC)
              </text>

              {/* Shopping flow */}
              <path
                d="M 200 550 Q 400 600 800 550"
                stroke="#10b981"
                strokeWidth="3"
                fill="none"
                markerEnd="url(#arrowhead)"
              />
              <text
                x="500"
                y="580"
                textAnchor="middle"
                fill="#10b981"
                fontSize="11"
                fontWeight="bold"
              >
                100 UC purchase
              </text>

              {/* Shopping fee to DAO */}
              <path
                d="M 700 520 Q 600 450 580 380"
                stroke="#3b82f6"
                strokeWidth="2"
                fill="none"
                markerEnd="url(#arrowhead-blue)"
              />
              <text
                x="640"
                y="450"
                textAnchor="middle"
                fill="#3b82f6"
                fontSize="10"
              >
                2% fee (2 UC)
              </text>

              {/* Worker wages */}
              <path
                d="M 500 270 L 500 140"
                stroke="#10b981"
                strokeWidth="3"
                fill="none"
                markerEnd="url(#arrowhead)"
              />
              <text
                x="520"
                y="205"
                fill="#10b981"
                fontSize="10"
                fontWeight="bold"
              >
                UC wages
              </text>

              {/* DAO investment in assets */}
              <path
                d="M 500 430 L 500 560"
                stroke="#dc2626"
                strokeWidth="3"
                fill="none"
                markerEnd="url(#arrowhead-red)"
              />
              <text
                x="520"
                y="495"
                fill="#dc2626"
                fontSize="10"
                fontWeight="bold"
              >
                Invest in assets
              </text>

              {/* Asset revenue back to DAO */}
              <path
                d="M 480 560 L 480 430"
                stroke="#fbbf24"
                strokeWidth="2"
                fill="none"
                markerEnd="url(#arrowhead-yellow)"
              />
              <text x="400" y="495" fill="#fbbf24" fontSize="10">
                Revenue
              </text>

              {/* SC distribution arrows */}
              <path
                d="M 420 350 Q 300 250 200 150"
                stroke="#fbbf24"
                strokeWidth="2"
                fill="none"
                markerEnd="url(#arrowhead-yellow)"
                strokeDasharray="5,5"
              />
              <path
                d="M 580 350 Q 700 250 800 150"
                stroke="#fbbf24"
                strokeWidth="2"
                fill="none"
                markerEnd="url(#arrowhead-yellow)"
                strokeDasharray="5,5"
              />
              <path
                d="M 420 350 Q 300 450 200 550"
                stroke="#fbbf24"
                strokeWidth="2"
                fill="none"
                markerEnd="url(#arrowhead-yellow)"
                strokeDasharray="5,5"
              />
              <path
                d="M 580 350 Q 700 450 800 550"
                stroke="#fbbf24"
                strokeWidth="2"
                fill="none"
                markerEnd="url(#arrowhead-yellow)"
                strokeDasharray="5,5"
              />
              <path
                d="M 500 270 Q 450 200 500 140"
                stroke="#fbbf24"
                strokeWidth="2"
                fill="none"
                markerEnd="url(#arrowhead-yellow)"
                strokeDasharray="5,5"
              />

              {/* Yield distribution */}
              <circle
                cx="350"
                cy="350"
                r="40"
                fill="none"
                stroke="#fbbf24"
                strokeWidth="2"
                strokeDasharray="5,5"
              />
              <text
                x="350"
                y="345"
                textAnchor="middle"
                fill="#fbbf24"
                fontSize="10"
                fontWeight="bold"
              >
                Yield Pool
              </text>
              <text
                x="350"
                y="358"
                textAnchor="middle"
                fill="#fbbf24"
                fontSize="9"
              >
                50% of fees
              </text>

              {/* Legend */}
              <g transform="translate(50, 30)">
                <rect
                  x="0"
                  y="0"
                  width="200"
                  height="80"
                  fill="#0f172a"
                  stroke="#475569"
                  strokeWidth="1"
                  rx="4"
                />
                <text
                  x="10"
                  y="15"
                  fill="white"
                  fontSize="12"
                  fontWeight="bold"
                >
                  Legend:
                </text>

                <line
                  x1="10"
                  y1="25"
                  x2="30"
                  y2="25"
                  stroke="#10b981"
                  strokeWidth="3"
                />
                <text x="35" y="29" fill="white" fontSize="10">
                  UC Flow
                </text>

                <line
                  x1="10"
                  y1="40"
                  x2="30"
                  y2="40"
                  stroke="#3b82f6"
                  strokeWidth="2"
                />
                <text x="35" y="44" fill="white" fontSize="10">
                  Fees to DAO
                </text>

                <line
                  x1="10"
                  y1="55"
                  x2="30"
                  y2="55"
                  stroke="#fbbf24"
                  strokeWidth="2"
                  strokeDasharray="3,3"
                />
                <text x="35" y="59" fill="white" fontSize="10">
                  SC Rewards
                </text>

                <line
                  x1="10"
                  y1="70"
                  x2="30"
                  y2="70"
                  stroke="#dc2626"
                  strokeWidth="2"
                />
                <text x="35" y="74" fill="white" fontSize="10">
                  Investments
                </text>
              </g>

              {/* Key Stats */}
              <g transform="translate(750, 30)">
                <rect
                  x="0"
                  y="0"
                  width="200"
                  height="100"
                  fill="#0f172a"
                  stroke="#475569"
                  strokeWidth="1"
                  rx="4"
                />
                <text
                  x="10"
                  y="15"
                  fill="white"
                  fontSize="12"
                  fontWeight="bold"
                >
                  Community Impact:
                </text>
                <text x="10" y="30" fill="#10b981" fontSize="10">
                  • $12M/year rent circulation
                </text>
                <text x="10" y="45" fill="#3b82f6" fontSize="10">
                  • $9M/year DAO treasury
                </text>
                <text x="10" y="60" fill="#fbbf24" fontSize="10">
                  • 1.2M SC earned annually
                </text>
                <text x="10" y="75" fill="#dc2626" fontSize="10">
                  • 10-15% GDP uplift
                </text>
                <text x="10" y="90" fill="white" fontSize="9">
                  *Based on 10K participants
                </text>
              </g>
            </svg>
          </div>

          {/* Process Steps */}
          <div className="mt-8 grid gap-6 md:grid-cols-3">
            <Card className="border-slate-600 bg-slate-700">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Badge className="bg-green-600">1</Badge>
                  <CardTitle className="text-lg text-white">
                    Participate
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="text-sm text-slate-300">
                Pay rent, shop, or work using Unity Coin (UC). Every transaction
                is tracked and verified on-chain.
              </CardContent>
            </Card>

            <Card className="border-slate-600 bg-slate-700">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Badge className="bg-blue-600">2</Badge>
                  <CardTitle className="text-lg text-white">
                    Earn & Pool
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="text-sm text-slate-300">
                Earn SoulaaniCoin (SC) for participation. Transaction fees flow
                to the community treasury for reinvestment.
              </CardContent>
            </Card>

            <Card className="border-slate-600 bg-slate-700">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Badge className="bg-yellow-600">3</Badge>
                  <CardTitle className="text-lg text-white">
                    Build Wealth
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="text-sm text-slate-300">
                Stake SC to earn yields. Vote on community investments. Access
                housing equity and legacy benefits.
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
