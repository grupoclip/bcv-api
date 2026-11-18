<?php

declare(strict_types=1);

namespace BcvToday\Tests;

use BcvToday\Internal\Decimal;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class DecimalTest extends TestCase
{
    private static function d(string $text): Decimal
    {
        $d = Decimal::parse($text);
        self::assertNotNull($d, $text);

        return $d;
    }

    /**
     * a, b, a / b and a * b, computed with Python's decimal module
     * (prec 28, ROUND_HALF_UP, normalized).
     *
     * @return list<array{string, string, string, string}>
     */
    public static function pythonVectors(): array
    {
        return [
            ['0.019772', '0.5', '0.039544', '0.009886'],
            ['5', '28816302', '0.0000001735128955825074293016501562', '144081510'],
            ['0.000006', '0.3', '0.00002', '0.0000018'],
            ['56978001', '132931.336', '428.6273102679115479588650189', '7574161795539.336'],
            ['66.423868', '0.5', '132.847736', '33.211934'],
            ['1787.4421', '0.00151262', '1181686.147214766431754174875', '2.703720669302'],
            ['0.0009', '915368.52', '0.0000000009832105652923261988515838408', '823.831668'],
            ['0.009', '0.0001277', '70.47768206734534064212999217', '0.0000011493'],
            ['9', '22.1146487', '0.4069700641457623516307541435', '199.0318383'],
            ['573.90467', '0.9824097', '584.1805816860318052641377625', '563.809514683299'],
            ['39.291', '0.089', '441.4719101123595505617977528', '3.496899'],
            ['0.0009', '664.53392', '0.0000013543326727400160401142503', '0.598080528'],
            ['483079.4', '0.000008', '60384925000', '3.8646352'],
            ['0.00096', '0.000062', '15.48387096774193548387096774', '0.00000005952'],
            ['0.5', '8472.83415', '0.00005901213114150239799040560708', '4236.417075'],
            ['0.91133', '53.3300498', '0.01708848957422124889896502591', '48.601274284234'],
            ['0.0001', '1090518', '0.00000000009169954095209799379744305', '109.0518'],
            ['0.0009469', '0.0632', '0.01498259493670886075949367089', '0.00005984408'],
            ['0.00001', '7.8', '0.000001282051282051282051282051282', '0.000078'],
            ['989.091', '2.119', '466.7725342142520056630486078', '2095.883829'],
            ['0.040994', '0.0000002', '204970', '0.0000000081988'],
            ['57.6129', '0.00000055', '104750727.2727272727272727273', '0.000031687095'],
            ['0.06804', '2419.6', '0.00002812035047115225657133410481', '164.629584'],
            ['0.02', '0.674', '0.02967359050445103857566765579', '0.01348'],
            ['0.01', '4619', '0.00000216497077289456592336003464', '46.19'],
            ['0.00000053', '0.79929', '0.0000006630884910357942674123284415', '0.0000004236237'],
            ['0.00000088', '703264880', '0.000000000000001251306620060424459131245115', '618.8730944'],
            ['9.383022', '0.418359', '22.42815859106652420528780306', '3.925471700898'],
            ['0.000007', '0.5', '0.000014', '0.0000035'],
            ['4.51', '5', '0.902', '22.55'],
        ];
    }

    #[DataProvider('pythonVectors')]
    public function testDivisionAndMultiplicationMatchPython(string $a, string $b, string $quotient, string $product): void
    {
        self::assertSame($quotient, self::d($a)->div(self::d($b))->toPlain());
        self::assertSame($product, self::d($a)->mul(self::d($b))->toPlain());
    }

    public function testParse(): void
    {
        self::assertSame('12.5', self::d('12.50')->toPlain());
        self::assertSame('-0.1', self::d('-0.1')->toPlain());
        self::assertSame('0.0000001', self::d('1e-7')->toPlain());
        self::assertSame('1000000000000000000000', self::d('1E+21')->toPlain());
        self::assertSame('0.5', self::d('.5')->toPlain());
        self::assertSame('5', self::d('5.')->toPlain());
        self::assertSame('0', self::d('-0')->toPlain());
        self::assertFalse(self::d('-0')->isNegative());
        foreach (['', '.', 'abc', '1.2.3', '1e', 'e5', '--1', '1e999999999'] as $bad) {
            self::assertNull(Decimal::parse($bad), $bad);
        }
    }

    public function testShortestFloatRepresentation(): void
    {
        self::assertSame('0.1', Decimal::fromFloat(0.1)->toPlain());
        self::assertSame('916.6477', Decimal::fromFloat(916.6477)->toPlain());
        self::assertSame('1007.38665582', Decimal::fromFloat(1007.38665582)->toPlain());
        self::assertSame('0.30000000000000004', Decimal::fromFloat(0.1 + 0.2)->toPlain());
        self::assertSame('1000000000000000', Decimal::fromFloat(1e15)->toPlain());
        self::assertSame('0.00000123', Decimal::fromFloat(1.23e-6)->toPlain());
    }

    public function testAddSubCmp(): void
    {
        self::assertSame('6.0104', self::d('360.5039')->sub(self::d('354.4935'))->toPlain());
        self::assertSame('-6.0104', self::d('354.4935')->sub(self::d('360.5039'))->toPlain());
        self::assertSame('0', self::d('1.5')->sub(self::d('1.50'))->toPlain());
        self::assertSame('0.3', self::d('0.1')->add(self::d('0.2'))->toPlain());
        self::assertSame('-0.1', self::d('0.1')->add(self::d('-0.2'))->toPlain());
        self::assertSame(1, self::d('2')->cmp(self::d('1.99999')));
        self::assertSame(-1, self::d('-2')->cmp(self::d('1')));
        self::assertSame(0, self::d('1.0')->cmp(self::d('1')));
        self::assertSame(-1, self::d('-2')->cmp(self::d('-1')));
    }

    public function testQuantizeHalfUpAwayFromZero(): void
    {
        self::assertSame('0.13', self::d('0.125')->toFixed(2));
        self::assertSame('0.12', self::d('0.1249999')->toFixed(2));
        self::assertSame('-0.13', self::d('-0.125')->toFixed(2));
        self::assertSame('0.00', self::d('0.0025')->toFixed(2));
        self::assertSame('0.003', self::d('0.0025')->toFixed(3));
        self::assertSame('3', self::d('2.5')->toFixed(0));
        self::assertSame('1.10', self::d('1.1')->toFixed(2));
        self::assertSame('10.0', self::d('9.95')->toFixed(1));
        self::assertSame('0.00', self::d('-0.001')->toFixed(2));
        self::assertSame('0.33', self::d('1')->div(self::d('3'))->toFixed(2));
        self::assertSame('0.6666666666666666666666666667', self::d('2')->div(self::d('3'))->toPlain());
    }

    public function testGroup(): void
    {
        self::assertSame('91,664.77', self::d('91664.77')->group(2));
        self::assertSame('1,007.3867', self::d('1007.38665582')->group(4));
        self::assertSame('-1,234,567.000', self::d('-1234567')->group(3));
        self::assertSame('999.00', self::d('999')->group(2));
    }
}
